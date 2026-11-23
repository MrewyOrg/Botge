//! Validates provider payloads and converts published image variants into catalog emotes.
//!
//! This module performs no network requests and does not mutate provider snapshots.

use anyhow::Result;
use serde::Deserialize;

use crate::emotes::{Emote, Source, valid_seven_id};

/// Normalizes a 7TV set and discards entries without usable media.
///
/// # Errors
///
/// Returns an error if the response is not valid 7TV JSON.
pub(super) fn parse_feed(bytes: &[u8]) -> Result<Vec<Emote>> {
  let set: SevenSet = serde_json::from_slice(bytes)?;
  Ok(
    set
      .emotes
      .into_iter()
      .filter_map(|entry| entry.data?.into_emote(Some((entry.name, entry.flags))))
      .collect(),
  )
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

fn valid_name(name: &str) -> bool {
  !name.trim().is_empty() && name.chars().count() <= 80 && !name.chars().any(char::is_control)
}

#[cfg(test)]
mod tests;
