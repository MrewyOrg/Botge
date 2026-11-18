// cspell:words replacen

//! Provider fetching, shared snapshots and bounded rendering, independent of persistence.

pub mod catalog;
mod providers;
pub mod rendering;

use anyhow::Result;
use botge_domain::{
  emotes::{Emote, GuildEmotes, Source, cdn_url, safe_id, valid_seven_id},
  providers::Providers,
};
use catalog::Catalog;
use providers::ProviderClient;
use std::sync::Arc;

/// A 7TV set that changed while a cached feed used it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetChange {
  /// The 7TV set ID.
  pub id: String,
  /// Whether the set is 7TV's global set, shared by every guild with global 7TV emotes.
  pub global: bool,
}

/// Provider clients and immutable feed snapshots shared by application operations.
pub struct Emotes {
  policy: Providers,
  client: Arc<ProviderClient>,
  events: std::borrow::Cow<'static, str>,
}

impl Emotes {
  /// Creates bounded provider clients without contacting the network.
  ///
  /// # Errors
  ///
  /// Returns an error if the shared HTTP client cannot be initialized.
  pub fn new(policy: Providers, twitch: Option<(String, String)>) -> Result<Self> {
    Ok(Self {
      policy,
      client: Arc::new(ProviderClient::new(twitch)?),
      events: std::borrow::Cow::Borrowed("wss://events.7tv.io/v3"),
    })
  }

  /// Resolves enabled feeds after the application supplies persisted guild state.
  pub async fn catalog(
    &self,
    settings: &GuildEmotes,
    added: Vec<Emote>,
    timeout: Option<std::time::Duration>,
  ) -> Catalog {
    Catalog::new(
      added,
      self
        .client
        .catalog(self.policy, settings, true, timeout)
        .await,
    )
  }

  /// Resolves only the guild's own additions and selected feeds, leaving out global feeds.
  pub async fn guild_catalog(&self, settings: &GuildEmotes, added: Vec<Emote>) -> Catalog {
    Catalog::new(
      added,
      self
        .client
        .catalog(self.policy, settings, false, None)
        .await,
    )
  }

  /// Reports whether operator policy permits individual additions.
  #[must_use]
  pub const fn added_emotes_enabled(&self) -> bool {
    self.policy.seven_added
  }

  /// Fetches an enabled, validated individual addition.
  ///
  /// # Errors
  ///
  /// Returns provider transport or decoding errors; invalid IDs and disabled additions yield none.
  pub async fn fetch_added(&self, id: &str) -> Result<Option<Emote>> {
    if !self.policy.seven_added || !valid_seven_id(id) {
      return Ok(None);
    }
    self.client.added(id).await
  }

  /// Watches enabled 7TV sets until the worker is cancelled.
  pub async fn watch_sets(&self) {
    self.client.watch_sets(&self.events).await;
  }

  /// Subscribes to 7TV sets that change while [`Self::watch_sets`] runs.
  ///
  /// A receiver that falls behind is told how many changes it missed.
  #[must_use]
  pub fn set_changes(&self) -> tokio::sync::broadcast::Receiver<SetChange> {
    self.client.set_changes.subscribe()
  }

  /// Counts 7TV event stream sessions that ended since startup.
  #[must_use]
  pub fn reconnects(&self) -> u64 {
    self
      .client
      .reconnects
      .load(std::sync::atomic::Ordering::Relaxed)
  }

  /// Shares the bounded HTTP client with renderer operations.
  #[must_use]
  pub fn http(&self) -> &reqwest::Client {
    self.client.http()
  }

  /// Redirects provider requests to an isolated loopback fixture before sharing the service.
  #[cfg(any(test, feature = "test-util"))]
  pub fn use_provider_fixture(&mut self, origin: reqwest::Url) {
    if let Some(client) = Arc::get_mut(&mut self.client) {
      self.events = std::borrow::Cow::Owned(origin.as_str().replacen("http", "ws", 1));
      client.test_origin = Some(origin);
    }
  }
}

impl std::fmt::Debug for Emotes {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("Emotes")
      .field("policy", &self.policy)
      .finish_non_exhaustive()
  }
}

#[cfg(test)]
mod tests;
