//! Validates provider payloads and converts published image variants into catalog emotes.
//!
//! This module performs no network requests and does not mutate provider snapshots.

use std::collections::HashMap;

use anyhow::Result;
use reqwest::Url;
use serde::Deserialize;

use super::Feed;
use crate::emotes::{Emote, Source, cdn_url, safe_id, valid_seven_id};

/// Normalizes the provider response and discards entries that cannot become usable emotes.
///
/// # Errors
///
/// Returns an error if the provider payload cannot be deserialized. Individual entries
/// that fail media or name validation are omitted from an otherwise usable feed.
pub(super) fn parse_feed(feed: Feed, bytes: &[u8]) -> Result<Vec<Emote>> {
  match feed {
    Feed::SevenTv => {
      let set: SevenSet = serde_json::from_slice(bytes)?;
      Ok(
        set
          .emotes
          .into_iter()
          .filter_map(|entry| {
            let flags = entry.flags;
            entry.data?.into_emote(Some((entry.name, flags)))
          })
          .collect(),
      )
    }
    Feed::BetterTtv => {
      let list: Vec<BetterTtvEmote> = serde_json::from_slice(bytes)?;
      Ok(
        list
          .into_iter()
          .filter_map(BetterTtvEmote::into_emote)
          .collect(),
      )
    }
    Feed::BetterTtvChannel => {
      let list: BetterTtvChannel = serde_json::from_slice(bytes)?;
      Ok(
        list
          .channel_emotes
          .into_iter()
          .chain(list.shared_emotes)
          .filter_map(BetterTtvEmote::into_emote)
          .collect(),
      )
    }
    Feed::Ffz => {
      let FfzSets {
        room,
        default_sets,
        mut sets,
      } = serde_json::from_slice(bytes)?;
      let set_ids = room.map_or_else(
        || default_sets.unwrap_or_else(|| vec![3]),
        |room| vec![room.set],
      );
      Ok(
        set_ids
          .into_iter()
          .filter_map(|id| sets.remove(&id.to_string()))
          .flat_map(|set| set.emoticons)
          .filter_map(FfzEmote::into_emote)
          .collect(),
      )
    }
    Feed::Twitch => {
      let response: TwitchSet = serde_json::from_slice(bytes)?;
      Ok(
        response
          .data
          .into_iter()
          .filter_map(TwitchEmote::into_emote)
          .collect(),
      )
    }
  }
}

/// Decodes an individual 7TV record and rejects a mismatched or unavailable ID.
///
/// # Errors
///
/// Returns an error when the provider record is not valid 7TV emote JSON.
pub(super) fn parse_added(bytes: &[u8], id: &str) -> Result<Option<Emote>> {
  let data: SevenEmote = serde_json::from_slice(bytes)?;
  Ok((data.id == id).then(|| data.into_emote(None)).flatten())
}

/// The emote entries returned for one 7TV set.
#[derive(Deserialize)]
struct SevenSet {
  #[serde(default)]
  emotes: Vec<SevenEntry>,
}

/// A set entry with its own name and flags. An unavailable emote can omit `data`.
#[derive(Deserialize)]
struct SevenEntry {
  name: String,
  flags: u32,
  data: Option<SevenEmote>,
}

/// A 7TV emote record before availability and media validation.
#[derive(Deserialize)]
struct SevenEmote {
  id: String,
  name: String,
  flags: u32,
  listed: Option<bool>,
  #[serde(default)]
  tags: Vec<String>,
  animated: bool,
  host: SevenHost,
}

/// Lists the media variants actually published for a 7TV emote.
#[derive(Deserialize)]
struct SevenHost {
  files: Vec<SevenFile>,
}

/// A published variant name, such as `2x.webp`.
#[derive(Deserialize)]
struct SevenFile {
  name: String,
}

impl SevenEmote {
  /// Uses the set-specific name and flags when present, including overlay behavior.
  fn into_emote(self, entry: Option<(String, u32)>) -> Option<Emote> {
    if !valid_seven_id(&self.id) || self.flags & (1 | 65_536) != 0 || self.listed == Some(false) {
      return None;
    }
    let added = entry.is_none();
    let (name, overlaying) = entry.map_or((self.name, self.flags & 256 != 0), |(name, flags)| {
      (name, flags & 1 != 0)
    });
    if !valid_name(&name) {
      return None;
    }
    let mut sizes = std::collections::BTreeMap::new();
    for scale in 1u16..=4 {
      let extensions: &[&str] = if self.animated {
        &["webp", "gif"]
      } else {
        &["png", "webp"]
      };
      if let Some(file) = extensions
        .iter()
        .map(|ext| format!("{scale}x.{ext}"))
        .find(|name| self.host.files.iter().any(|file| file.name == *name))
      {
        sizes.insert(
          scale,
          format!("https://cdn.7tv.app/emote/{}/{file}", self.id),
        );
      }
    }
    let image = sizes
      .iter()
      .min_by_key(|(scale, _)| (scale.abs_diff(2), **scale))?
      .1
      .clone();
    Some(Emote {
      id: self.id,
      name,
      source: Source::SevenTv,
      image,
      sizes,
      animated: self.animated,
      overlaying,
      tags: self.tags.into_iter().take(32).collect(),
      added,
    })
  }
}

/// BTTV's channel-owned and shared emotes, kept separate in the provider response.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BetterTtvChannel {
  channel_emotes: Vec<BetterTtvEmote>,
  shared_emotes: Vec<BetterTtvEmote>,
}

/// The BTTV fields used to construct a CDN image URL.
#[derive(Deserialize)]
struct BetterTtvEmote {
  id: String,
  code: String,
  animated: bool,
}

impl BetterTtvEmote {
  /// Builds the three published BTTV scales with a 2× catalog default.
  fn into_emote(self) -> Option<Emote> {
    if !safe_id(&self.id) || !valid_name(&self.code) {
      return None;
    }
    let ext = if self.animated { "gif" } else { "png" };
    let image = format!("https://cdn.betterttv.net/emote/{}/2x.{ext}", self.id);
    let sizes = (1..=3)
      .map(|scale| {
        (
          scale,
          format!("https://cdn.betterttv.net/emote/{}/{scale}x.{ext}", self.id),
        )
      })
      .collect();
    Some(Emote {
      id: self.id,
      name: self.code,
      source: Source::BetterTtv,
      image,
      sizes,
      animated: self.animated,
      overlaying: false,
      tags: Vec::new(),
      added: false,
    })
  }
}

/// FFZ sets and the metadata selecting the channel or global set IDs.
#[derive(Deserialize)]
struct FfzSets {
  sets: HashMap<String, FfzSet>,
  room: Option<FfzRoom>,
  default_sets: Option<Vec<u64>>,
}

/// Selects the FFZ set attached to a channel.
#[derive(Deserialize)]
struct FfzRoom {
  set: u64,
}

/// The emote records belonging to one FFZ set.
#[derive(Deserialize)]
struct FfzSet {
  emoticons: Vec<FfzEmote>,
}

/// An FFZ emote with CDN URLs keyed by image scale.
#[derive(Deserialize)]
struct FfzEmote {
  id: u64,
  name: String,
  urls: HashMap<String, String>,
}

impl FfzEmote {
  /// Chooses an available image scale and validates the resolved CDN URL.
  fn into_emote(self) -> Option<Emote> {
    if !valid_name(&self.name) {
      return None;
    }
    let sizes: std::collections::BTreeMap<u16, String> = self
      .urls
      .into_iter()
      .filter_map(|(scale, url)| {
        let scale = scale
          .parse::<u16>()
          .ok()
          .filter(|scale| [1, 2, 4].contains(scale))?;
        let url = Url::parse("https://cdn.frankerfacez.com")
          .ok()?
          .join(&url)
          .ok()?;
        Some((scale, cdn_url(url.as_str(), Source::Ffz)?.to_string()))
      })
      .collect();
    let image = sizes
      .iter()
      .min_by_key(|(scale, _)| (scale.abs_diff(2), **scale))?
      .1
      .clone();
    Some(Emote {
      id: self.id.to_string(),
      name: self.name,
      source: Source::Ffz,
      image,
      sizes,
      animated: false,
      overlaying: false,
      tags: Vec::new(),
      added: false,
    })
  }
}

/// Twitch's global emote response envelope.
#[derive(Deserialize)]
struct TwitchSet {
  data: Vec<TwitchEmote>,
}

/// A Twitch emote and the image formats offered for it.
#[derive(Deserialize)]
struct TwitchEmote {
  id: String,
  name: String,
  format: Vec<String>,
  #[serde(default = "twitch_scales")]
  scale: Vec<String>,
}

/// Supplies the standard scales when a Twitch response omits its advertised scale list.
fn twitch_scales() -> Vec<String> {
  vec!["1.0".into(), "2.0".into(), "3.0".into()]
}

impl TwitchEmote {
  /// Keeps advertised dark-theme scales, preferring animated media and a scale-2 default.
  fn into_emote(self) -> Option<Emote> {
    if !safe_id(&self.id) || !valid_name(&self.name) {
      return None;
    }
    let animated = self.format.iter().any(|format| format == "animated");
    let format = if animated { "animated" } else { "static" };
    let sizes: std::collections::BTreeMap<u16, String> = self
      .scale
      .iter()
      .filter_map(|scale| {
        let number = match scale.as_str() {
          "1.0" => 1,
          "2.0" => 2,
          "3.0" => 3,
          _ => return None,
        };
        Some((
          number,
          format!(
            "https://static-cdn.jtvnw.net/emoticons/v2/{}/{format}/dark/{scale}",
            self.id
          ),
        ))
      })
      .collect();
    let image = sizes
      .iter()
      .min_by_key(|(scale, _)| (scale.abs_diff(2), **scale))?
      .1
      .clone();
    Some(Emote {
      id: self.id,
      name: self.name,
      source: Source::Twitch,
      image,
      sizes,
      animated,
      overlaying: false,
      tags: Vec::new(),
      added: false,
    })
  }
}

/// Rejects blank, oversized, or control-character names before catalog insertion.
fn valid_name(name: &str) -> bool {
  !name.trim().is_empty() && name.chars().count() <= 80 && !name.chars().any(char::is_control)
}

#[cfg(test)]
mod tests;
