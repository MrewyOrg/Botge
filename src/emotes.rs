//! Combines provider snapshots and guild additions into catalogs for Discord and the Activity.

mod providers;
pub(crate) mod rendering;

use std::{collections::HashSet, num::NonZeroU64, sync::Arc};

use anyhow::Result;
use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::{config::Providers, storage::Store};

use providers::ProviderClient;

/// The upstream provider used for media allowlisting and catalog labels.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) enum Source {
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
  const fn cdn(self) -> (&'static str, &'static str) {
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
pub(crate) struct Emote {
  pub(crate) id: String,
  pub(crate) name: String,
  pub(crate) source: Source,
  /// Default catalog image; command rendering can select another published scale.
  pub(crate) image: String,
  /// Provider scale labels mapped to CDN URLs, also persisted with individual additions.
  /// Older saved records have no variants and retain their default image until refreshed.
  #[serde(default)]
  pub(crate) sizes: std::collections::BTreeMap<u16, String>,
  pub(crate) animated: bool,
  /// Draw this layer over the preceding base emote in a composition.
  #[serde(alias = "zeroWidth")]
  pub(crate) overlaying: bool,
  #[serde(default)]
  pub(crate) tags: Vec<String>,
  /// Identifies an individual guild addition, as opposed to a provider-feed entry.
  pub(crate) added: bool,
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
  pub(crate) fn image_at(&self, scale: u16) -> &str {
    self
      .sizes
      .iter()
      .min_by_key(|(size, _)| (size.abs_diff(scale), **size))
      .map_or(self.image.as_str(), |(_, image)| image.as_str())
  }

  /// Converts the CDN URL to an Activity-relative path while retaining its query.
  fn mapped_image(&self) -> Option<String> {
    let url = cdn_url(&self.image, self.source)?;
    let (_, path) = self.source.cdn();
    let query = url
      .query()
      .map_or_else(String::new, |query| format!("?{query}"));
    Some(format!("/{path}-cdn{}{query}", url.path()))
  }
}

/// The Activity's serialized view borrows names and tags from the catalog snapshot.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogEmote<'a> {
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogDetails<'a> {
  name: &'a str,
  source: Source,
  image: String,
  animated: bool,
  overlaying: bool,
  tags: &'a [String],
  added: bool,
}

/// Maps validated CDN URLs to browser-relative paths and keeps catalog precedence.
pub(crate) fn browser_catalog(emotes: &[Emote]) -> Vec<CatalogEmote<'_>> {
  let mut names = HashSet::new();
  emotes
    .iter()
    .filter_map(|emote| {
      let image = emote.mapped_image()?;
      let unique = names.insert(emote.name.to_ascii_lowercase());
      Some(CatalogEmote {
        details: CatalogDetails {
          name: &emote.name,
          source: emote.source,
          image,
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
pub(crate) struct GuildEmotes {
  pub(crate) seven_tv_set: Option<String>,
  pub(crate) bttv_twitch_id: Option<String>,
  pub(crate) ffz_channel: Option<String>,
  pub(crate) allow_everyone: bool,
  pub(crate) allowed_roles: Vec<String>,
}

impl GuildEmotes {
  /// Checks IDs, channel names, and the role selection before these values are stored.
  pub(crate) fn valid(&self) -> bool {
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
  pub(crate) fn can_manage(&self, admin: bool, roles: &[String]) -> bool {
    admin || self.allow_everyone || roles.iter().any(|role| self.allowed_roles.contains(role))
  }
}

/// Accepts both 7TV's older 24-digit hex IDs and its 26-character IDs.
pub(crate) fn valid_seven_id(id: &str) -> bool {
  (id.len() == 24 && id.bytes().all(|b| b.is_ascii_hexdigit()))
    || (id.len() == 26 && id.bytes().all(|b| b.is_ascii_alphanumeric()))
}

/// Checks an opaque provider ID before it becomes a CDN path component.
fn safe_id(id: &str) -> bool {
  !id.is_empty()
    && id.len() <= 80
    && id
      .bytes()
      .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Limits media downloads to the provider's HTTPS CDN and default port.
fn cdn_url(input: &str, source: Source) -> Option<Url> {
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
pub(crate) fn find_emote<'a>(emotes: &'a [Emote], query: &str) -> Option<&'a Emote> {
  let query = query.trim();
  if query.is_empty() {
    return None;
  }
  emotes
    .iter()
    .find(|emote| emote.name.eq_ignore_ascii_case(query))
    .or_else(|| {
      let query = query.to_ascii_lowercase();
      let mut matches = emotes
        .iter()
        .filter(|emote| emote.name.to_ascii_lowercase().contains(&query));
      let first = matches.next()?;
      matches
        .all(|candidate| candidate.name.eq_ignore_ascii_case(&first.name))
        .then_some(first)
    })
}

/// Emote service with provider switches fixed at startup and a shared cache.
pub(crate) struct Emotes {
  policy: Providers,
  store: Arc<Store>,
  client: Arc<ProviderClient>,
}

impl Emotes {
  /// Sets up provider access with the operator's fixed policy and shared persistence.
  ///
  /// # Errors
  ///
  /// Returns an error if the bounded provider HTTP client cannot be initialized.
  pub(crate) fn new(
    policy: Providers,
    store: Arc<Store>,
    twitch: Option<(String, String)>,
  ) -> Result<Self> {
    Ok(Self {
      policy,
      store,
      client: Arc::new(ProviderClient::new(twitch)?),
    })
  }

  /// Builds the catalog with enabled guild additions before provider-feed entries.
  ///
  /// With no guild, uses only enabled global feeds. Storage failures are returned to the
  /// caller, while provider outages can leave individual feeds stale or empty.
  ///
  /// # Errors
  ///
  /// Returns an error if guild settings or additions cannot be read, including failure of the
  /// blocking database task. Provider outages use stale or empty snapshots instead.
  pub(crate) async fn catalog(&self, guild: Option<NonZeroU64>) -> Result<Vec<Emote>> {
    self.catalog_with_timeout(guild, None).await
  }

  /// Limits the interaction's wait without cancelling a shared provider refresh.
  ///
  /// # Errors
  ///
  /// Returns the same storage and task errors as [`Self::catalog`]. Feed timeouts contribute
  /// cached or empty results without cancelling the shared refresh.
  pub(crate) async fn catalog_for_autocomplete(
    &self,
    guild: Option<NonZeroU64>,
  ) -> Result<Vec<Emote>> {
    self
      .catalog_with_timeout(guild, Some(std::time::Duration::from_millis(1400)))
      .await
  }

  /// Loads guild state on the blocking pool and forwards the wait limit to each feed.
  ///
  /// # Errors
  ///
  /// Returns an error if the blocking database task fails or saved guild state cannot be decoded.
  async fn catalog_with_timeout(
    &self,
    guild: Option<NonZeroU64>,
    timeout: Option<std::time::Duration>,
  ) -> Result<Vec<Emote>> {
    let store = Arc::clone(&self.store);
    let added_enabled = self.policy.seven_added;
    let (mut added, settings) = tokio::task::spawn_blocking(move || {
      let Some(guild) = guild else {
        return Ok::<_, anyhow::Error>((vec![], GuildEmotes::default()));
      };
      let added = if added_enabled {
        store.added_emotes(guild)?
      } else {
        vec![]
      };
      Ok((added, store.guild_emotes(guild)?))
    })
    .await??;
    added.extend(self.client.catalog(self.policy, &settings, timeout).await);
    Ok(added)
  }

  /// Reports the operator's switch for individually added 7TV emotes.
  pub(crate) const fn added_emotes_enabled(&self) -> bool {
    self.policy.seven_added
  }

  /// Reads a user's render preference off the async executor.
  ///
  /// # Errors
  ///
  /// Returns an error if the blocking task fails or the saved border cannot be read.
  pub(crate) async fn border_for_user(&self, user: NonZeroU64) -> Result<Option<u32>> {
    let store = Arc::clone(&self.store);
    tokio::task::spawn_blocking(move || store.emote_border(user)).await?
  }

  /// Fetches one validated 7TV ID when individual emotes are enabled.
  ///
  /// # Errors
  ///
  /// Returns an error for provider transport, HTTP, body-limit, or decoding failures.
  /// Disabled additions, invalid IDs, and unavailable emotes produce `Ok(None)`.
  pub(crate) async fn fetch_added(&self, id: &str) -> Result<Option<Emote>> {
    if !self.added_emotes_enabled() || !valid_seven_id(id) {
      return Ok(None);
    }
    self.client.added(id).await
  }

  /// Runs the long-lived 7TV event worker until its task is cancelled.
  pub(crate) async fn watch_sets(&self) {
    self.client.watch_sets("wss://events.7tv.io/v3").await;
  }

  /// Borrows the shared HTTP client for renderer downloads.
  pub(crate) fn http(&self) -> &reqwest::Client {
    self.client.http()
  }
}

#[cfg(test)]
pub(crate) mod tests;
