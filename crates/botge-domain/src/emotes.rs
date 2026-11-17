//! Provider-independent emote records and catalog rules.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use url::Url;

/// The upstream provider used for media allowlisting and catalog labels.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Source {
  /// 7TV set feeds and individual additions.
  #[doc(alias = "7TV")]
  #[serde(rename = "7TV")]
  SevenTv,
  /// BTTV global and channel feeds.
  #[doc(alias = "BTTV")]
  #[serde(rename = "BTTV")]
  BetterTtv,
  /// FFZ global and channel feeds.
  #[doc(alias = "FrankerFaceZ")]
  #[serde(rename = "FFZ")]
  Ffz,
  /// Twitch global emotes, enabled only with operator credentials.
  Twitch,
}

impl Source {
  /// Returns the provider hostname and the path prefix used by the image cache.
  #[must_use]
  pub const fn cdn(self) -> (&'static str, &'static str) {
    match self {
      Self::SevenTv => ("cdn.7tv.app", "7tv"),
      Self::BetterTtv => ("cdn.betterttv.net", "bttv"),
      Self::Ffz => ("cdn.frankerfacez.com", "ffz"),
      Self::Twitch => ("static-cdn.jtvnw.net", "twitch"),
    }
  }
}

/// A provider-independent emote record used in catalogs and persisted guild additions.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Emote {
  /// The provider identifier, retained unchanged for persistence.
  pub id: String,
  /// The provider or guild-selected display name.
  pub name: String,
  /// The upstream provider that owns the record.
  pub source: Source,
  /// Default catalog image; command rendering can select another published scale.
  pub image: String,
  /// Provider scale labels mapped to CDN URLs, also persisted with individual additions.
  /// Older saved records have no variants and retain their default image until refreshed.
  #[serde(default)]
  pub sizes: std::collections::BTreeMap<u16, String>,
  /// Whether the provider advertises animated media.
  pub animated: bool,
  /// Draw this layer over the preceding base emote in a composition.
  #[serde(alias = "zeroWidth")]
  pub overlaying: bool,
  #[serde(default)]
  /// Provider-supplied search tags.
  pub tags: Vec<String>,
  /// Identifies an individual guild addition, as opposed to a provider-feed entry.
  pub added: bool,
}

impl Emote {
  /// Chooses the nearest published scale, preferring the smaller scale on a tie.
  ///
  /// Older persisted entries without variants retain [`Self::image`].
  ///
  /// # Examples
  ///
  /// With published scales 1, 2, and 4:
  ///
  /// | Requested scale | Selected scale |
  /// | --- | --- |
  /// | 1 | 1 |
  /// | 3 | 2 |
  /// | 4 | 4 |
  #[must_use]
  pub fn image_at(&self, scale: u16) -> &str {
    self
      .sizes
      .iter()
      .min_by_key(|(size, _)| (size.abs_diff(scale), **size))
      .map_or(self.image.as_str(), |(_, image)| image.as_str())
  }

  /// Converts a CDN URL to an Activity-relative path while retaining its query.
  fn mapped_image(&self, image: &str) -> Option<String> {
    let url = cdn_url(image, self.source)?;
    let (_, path) = self.source.cdn();
    let query = url
      .query()
      .map_or_else(String::new, |query| format!("?{query}"));
    Some(format!("/{path}-cdn{}{query}", url.path()))
  }
}

/// The Activity's serialized view borrows names and tags from the catalog snapshot.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEmote<'a> {
  #[serde(flatten)]
  details: CatalogDetails<'a>,
  /// Only the first entry for a case-insensitive name is eligible for a compose token.
  #[serde(skip_serializing_if = "Option::is_none")]
  compose_token: Option<&'a str>,
  /// Lets the Activity identify a 7TV emote without relying on its display name.
  #[serde(rename = "sevenTVId", skip_serializing_if = "Option::is_none")]
  seven_tv_id: Option<&'a str>,
}

/// The fields flattened into each browser catalog entry.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogDetails<'a> {
  name: &'a str,
  source: Source,
  image: String,
  /// The largest published scale up to 4×, omitted when it is the catalog image.
  #[serde(skip_serializing_if = "Option::is_none")]
  preview: Option<String>,
  animated: bool,
  overlaying: bool,
  tags: &'a [String],
  added: bool,
}

/// Maps validated CDN URLs to browser-relative paths and keeps catalog precedence.
///
/// Entries whose catalog image is not on the provider's CDN are omitted. A larger preview scale
/// that fails the same check is omitted while the entry is kept.
pub fn browser_catalog<'a>(
  emotes: impl IntoIterator<Item = &'a Emote, IntoIter: ExactSizeIterator>,
) -> Vec<CatalogEmote<'a>> {
  let emotes = emotes.into_iter();
  let mut names = HashSet::with_capacity(emotes.len());
  emotes
    .filter_map(|emote| {
      let image = emote.mapped_image(&emote.image)?;
      let preview = emote
        .mapped_image(emote.image_at(4))
        .filter(|preview| *preview != image);
      let unique = names.insert(emote.name.to_ascii_lowercase());
      Some(CatalogEmote {
        details: CatalogDetails {
          name: &emote.name,
          source: emote.source,
          image,
          preview,
          animated: emote.animated,
          overlaying: emote.overlaying,
          tags: &emote.tags,
          added: emote.added,
        },
        compose_token: (unique
          && emote.name.len() > 1
          && !emote.name.chars().any(char::is_whitespace))
        .then_some(emote.name.as_str()),
        seven_tv_id: (emote.source == Source::SevenTv).then_some(emote.id.as_str()),
      })
    })
    .collect()
}

/// Guild-level feed selections and the policy for managing individual additions.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct GuildEmotes {
  /// The selected personal 7TV set, when enabled.
  pub seven_tv_set: Option<String>,
  /// The Twitch channel whose BTTV additions are included.
  pub bttv_twitch_id: Option<String>,
  /// The FFZ channel name whose emotes are included.
  pub ffz_channel: Option<String>,
  /// Whether all guild members may manage individual additions.
  pub allow_everyone: bool,
  /// Role IDs allowed to manage individual additions.
  pub allowed_roles: Vec<String>,
}

impl GuildEmotes {
  /// Checks IDs, channel names, and the role selection before these values are stored.
  pub fn valid(&self) -> bool {
    self.seven_tv_set.as_deref().is_none_or(valid_seven_id)
      && self
        .bttv_twitch_id
        .as_deref()
        .is_none_or(|id| !id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()))
      && self.ffz_channel.as_deref().is_none_or(|name| {
        !name.is_empty()
          && name.len() <= 25
          && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
      })
      && self.allowed_roles.len() <= 25
      && self
        .allowed_roles
        .iter()
        .all(|id| crate::settings::discord_id(id).is_some())
  }

  /// Grants management through administrator access, the everyone switch, or a matching role.
  #[must_use]
  pub fn can_manage(&self, admin: bool, roles: &[String]) -> bool {
    admin || self.allow_everyone || roles.iter().any(|role| self.allowed_roles.contains(role))
  }
}

/// Accepts both 7TV's older 24-digit hex IDs and its 26-character IDs.
#[must_use]
pub fn valid_seven_id(id: &str) -> bool {
  (id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()))
    || (id.len() == 26 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// Checks an opaque provider ID before it becomes a CDN path component.
#[must_use]
pub fn safe_id(id: &str) -> bool {
  !id.is_empty()
    && id.len() <= 80
    && id
      .bytes()
      .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Limits media downloads to the provider's HTTPS CDN and default port.
#[must_use]
pub fn cdn_url(input: &str, source: Source) -> Option<Url> {
  let url = Url::parse(input).ok()?;
  (url.scheme() == "https"
    && url.host_str() == Some(source.cdn().0)
    && url.port().is_none()
    && url.username().is_empty()
    && url.password().is_none()
    && url.fragment().is_none()
    && url.path() != "/")
    .then_some(url)
}

/// Prefers an exact name. A substring resolves only when all matches share the same name.
///
/// Matching ignores ASCII case and surrounding whitespace. Catalog order decides ties
/// between entries with the same name. Blank and ambiguous queries return `None`.
pub fn find_emote<'a>(
  emotes: impl IntoIterator<Item = &'a Emote, IntoIter: Clone + ExactSizeIterator>,
  query: &str,
) -> Option<&'a Emote> {
  let emotes = emotes.into_iter();
  let query = query.trim();
  if query.is_empty() {
    return None;
  }
  emotes
    .clone()
    .find(|emote| emote.name.eq_ignore_ascii_case(query))
    .or_else(|| {
      let query = query.to_ascii_lowercase();
      let mut matches = emotes.filter(|emote| emote.name.to_ascii_lowercase().contains(&query));
      let first = matches.next()?;
      matches
        .all(|candidate| candidate.name.eq_ignore_ascii_case(&first.name))
        .then_some(first)
    })
}

#[cfg(test)]
mod tests;
