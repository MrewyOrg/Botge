//! Shared application operations coordinating persistence and provider services.
use anyhow::Result;
use botge_domain::{
  emotes::{Emote, GuildEmotes, valid_seven_id},
  providers::Providers,
};
use botge_storage::Store;
use std::{num::NonZeroU64, sync::Arc, time::Duration};

/// Maximum time autocomplete waits for a provider refresh before using its last snapshot.
const AUTOCOMPLETE_REFRESH_WAIT: Duration = Duration::from_millis(1400);

/// Compositions that may resolve, download and render at the same time.
///
/// Each render stages at most 20 MiB of inputs and a 20 MiB attachment on the render tmpfs and runs
/// one single-threaded `FFmpeg` process; see `docs/RESOURCE_USAGE.md` before raising this.
pub const RENDER_SLOTS: usize = 5;

/// Emote service with provider switches fixed at startup and a shared cache.
#[derive(Debug)]
pub struct Application {
  policy: Providers,
  store: Arc<Store>,
  client: botge_emotes::Emotes,
  render_slot: tokio::sync::Semaphore,
  metrics: Metrics,
  games: game::Games,
  catalog_watch: catalog_watch::CatalogWatch,
}

impl Application {
  /// Sets up provider access with the operator's fixed policy and shared persistence.
  ///
  /// # Errors
  ///
  /// Returns an error if the bounded provider HTTP client cannot be initialized.
  pub fn new(policy: Providers, store: Arc<Store>) -> Result<Self> {
    Ok(Self {
      policy,
      store,
      client: botge_emotes::Emotes::new(policy)?,
      render_slot: tokio::sync::Semaphore::new(RENDER_SLOTS),
      metrics: Metrics::default(),
      games: game::Games::default(),
      catalog_watch: catalog_watch::CatalogWatch::default(),
    })
  }

  /// Shares the operation counters with the adapters that record them.
  #[must_use]
  pub const fn metrics(&self) -> &Metrics {
    &self.metrics
  }

  /// Renders every counter, including the provider client's 7TV reconnects.
  #[must_use]
  pub fn render_metrics(&self) -> String {
    self.metrics.render(self.client.reconnects())
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
  pub async fn catalog(&self, guild: Option<NonZeroU64>) -> Result<Catalog> {
    self.catalog_with_timeout(guild, None).await
  }

  /// Limits the interaction's wait without cancelling a shared provider refresh.
  ///
  /// # Errors
  ///
  /// Returns the same storage and task errors as [`Self::catalog`]. Feed timeouts contribute
  /// cached or empty results without cancelling the shared refresh.
  pub async fn catalog_for_autocomplete(&self, guild: Option<NonZeroU64>) -> Result<Catalog> {
    self
      .catalog_with_timeout(guild, Some(AUTOCOMPLETE_REFRESH_WAIT))
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
    timeout: Option<Duration>,
  ) -> Result<Catalog> {
    let store = Arc::clone(&self.store);
    let added_enabled = self.policy.seven_added;
    let (added, settings) = tokio::task::spawn_blocking(move || {
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
    Ok(self.client.catalog(&settings, added, timeout).await)
  }

  /// Reports the operator's switch for individually added 7TV emotes.
  #[must_use]
  pub const fn added_emotes_enabled(&self) -> bool {
    self.policy.seven_added
  }

  /// Reads a user's render preference off the async executor.
  ///
  /// # Errors
  ///
  /// Returns an error if the blocking task fails or the saved border cannot be read.
  pub async fn border_for_user(&self, user: NonZeroU64) -> Result<Option<u32>> {
    let store = Arc::clone(&self.store);
    tokio::task::spawn_blocking(move || store.emote_border(user)).await?
  }

  /// Fetches one validated 7TV ID when individual emotes are enabled.
  ///
  /// # Errors
  ///
  /// Returns an error for provider transport, HTTP, body-limit, or decoding failures.
  /// Disabled additions, invalid IDs, and unavailable emotes produce `Ok(None)`.
  pub async fn fetch_added(&self, id: &str) -> Result<Option<Emote>> {
    if !self.added_emotes_enabled() || !valid_seven_id(id) {
      return Ok(None);
    }
    self.client.fetch_added(id).await
  }

  /// Runs the long-lived 7TV event worker until its task is cancelled.
  ///
  /// Set edits it receives are announced to open catalog watches.
  pub async fn watch_sets(self: Arc<Self>) {
    let sets = self.client.set_changes();
    tokio::join!(self.client.watch_sets(), self.relay_set_changes(sets));
  }
}

impl Application {
  /// Redirects providers before the application is shared with adapters.
  #[cfg(any(test, feature = "test-util"))]
  pub fn use_provider_fixture(&mut self, origin: url::Url) {
    self.client.use_provider_fixture(origin);
  }
}

#[cfg(test)]
mod tests;

pub mod access;

pub mod voice;

mod operations;

#[doc(inline)]
pub use operations::{EmoteAction, EmoteChange, GuildCatalog};

mod composition;

pub mod game;

mod catalog_history;
mod catalog_watch;
mod tickets;
#[doc(inline)]
pub use catalog_watch::{CatalogChange, CatalogWatcher, WatchTicket};

mod metrics;
#[doc(inline)]
pub use botge_emotes::{catalog::Catalog, rendering::Layer};
#[doc(inline)]
pub use composition::{ComposeRequest, Composition};
#[doc(inline)]
pub use metrics::Metrics;
impl Application {
  /// Holds every render slot while a fixture verifies busy responses.
  ///
  /// # Errors
  /// Returns an error if the admission semaphore was closed.
  #[cfg(any(test, feature = "test-util"))]
  pub async fn reserve_render_fixture(&self) -> Result<tokio::sync::SemaphorePermit<'_>> {
    #[expect(
      clippy::cast_possible_truncation,
      reason = "The slot count is a small constant"
    )]
    Ok(self.render_slot.acquire_many(RENDER_SLOTS as u32).await?)
  }
}

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
