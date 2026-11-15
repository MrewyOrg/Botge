//! Reconciles saved guild preferences with Discord voice membership and channel status.
//!
//! Settings writes only wake the worker; this module applies them asynchronously. Gateway
//! joins and media transport are separate steps, so a media failure need not undo membership.
//! A guild whose call is already connected is not joined again; only its status is refreshed.
//! Guilds that keep failing are retried with exponential backoff on periodic passes.

// Clippy and voice-worker tests need a deeper Send check for Songbird futures.
#![recursion_limit = "256"]

use std::{
  collections::{HashMap, HashSet},
  num::NonZeroU64,
  sync::Arc,
  time::Duration,
};

use anyhow::Context as _;
use serde::Serialize;
use serenity::{all::ChannelId, http::Http};
use songbird::{
  Songbird,
  id::{ChannelId as VoiceChannelId, GuildId},
};
use tokio::{
  sync::{Notify, watch},
  time::Instant,
};

use botge_app::voice::VoiceSettingsSource;
use botge_domain::settings::VoiceSettings;

/// Periodic passes wait at most this long before retrying a failing guild.
const MAX_BACKOFF: Duration = Duration::from_hours(1);

/// What the worker remembers about each guild between passes.
#[derive(Debug, Default)]
struct Guilds {
  /// Status text Discord last accepted, keyed by guild, with its channel.
  statuses: HashMap<NonZeroU64, (NonZeroU64, String)>,
  /// Guilds whose last join finished with a working media connection.
  connected: HashSet<NonZeroU64>,
  /// Consecutive failures and the earliest periodic retry for failing guilds.
  retry: HashMap<NonZeroU64, (u32, Instant)>,
}

impl Guilds {
  /// Whether a periodic pass should skip this guild because it is backing off.
  fn backing_off(&self, guild: NonZeroU64, now: Instant) -> bool {
    self.retry.get(&guild).is_some_and(|(_, at)| now < *at)
  }

  /// Clears backoff after success, or doubles the wait (from one minute) after a failure.
  fn record(&mut self, guild: NonZeroU64, succeeded: bool, now: Instant) {
    if succeeded {
      self.retry.remove(&guild);
      return;
    }
    let failures = self.retry.get(&guild).map_or(0, |(failures, _)| *failures) + 1;
    let wait = Duration::from_mins(1)
      .saturating_mul(1 << failures.saturating_sub(1).min(6))
      .min(MAX_BACKOFF);
    self.retry.insert(guild, (failures, now + wait));
  }
}

#[derive(Debug, Eq, PartialEq)]
/// The gateway action needed for the guild's saved channel selection.
enum ConnectionChange {
  Keep,
  Join(NonZeroU64),
  Disconnect,
}

/// Chooses whether to apply a join, leave an existing call, or leave the guild idle.
const fn connection_change(
  current: Option<NonZeroU64>,
  desired: Option<NonZeroU64>,
) -> ConnectionChange {
  if let Some(channel) = desired {
    // `apply` skips the join when this exact call is already connected and healthy.
    ConnectionChange::Join(channel)
  } else if current.is_some() {
    ConnectionChange::Disconnect
  } else {
    ConnectionChange::Keep
  }
}

/// Waits for the gateway to be ready, then applies saved channel and status settings.
///
/// Settings changes and gateway notifications wake the worker and apply every guild. A
/// periodic pass retries transient failures but skips guilds still backing off, and a timeout
/// per guild keeps one slow connection from blocking the others indefinitely. The worker exits
/// if the gateway closes before becoming ready.
pub async fn reconcile<S: VoiceSettingsSource>(
  store: Arc<S>,
  songbird: Arc<Songbird>,
  http: Arc<Http>,
  changed: Arc<Notify>,
  mut ready: watch::Receiver<bool>,
) {
  if ready.wait_for(|ready| *ready).await.is_err() {
    return;
  }
  let mut guilds = Guilds::default();
  let mut periodic = tokio::time::interval(Duration::from_mins(1));
  periodic.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
  loop {
    let forced = tokio::select! {
        () = changed.notified() => true,
        _ = periodic.tick() => false,
    };
    apply_saved(Arc::clone(&store), &songbird, &http, &mut guilds, forced).await;
  }
}

/// Reads saved settings off the executor and applies each guild within its own deadline.
///
/// A `forced` pass (a settings change or gateway event) ignores backoff.
async fn apply_saved<S: VoiceSettingsSource>(
  store: Arc<S>,
  songbird: &Songbird,
  http: &Http,
  guilds: &mut Guilds,
  forced: bool,
) {
  let settings = match store.load_voice_settings().await {
    Ok(Ok(settings)) => settings,
    Ok(Err(error)) => {
      tracing::error!(%error, message = "could not read saved voice settings");
      return;
    }
    Err(error) => {
      tracing::error!(%error, message = "voice settings task failed");
      return;
    }
  };
  for (guild, settings) in settings {
    if !forced && guilds.backing_off(guild, Instant::now()) {
      continue;
    }
    let succeeded = apply_bounded(songbird, http, guild, &settings, guilds).await;
    guilds.record(guild, succeeded, Instant::now());
  }
}

/// Applies one guild within thirty seconds, logging failures without stopping the worker.
///
/// Returns whether the guild was applied successfully.
async fn apply_bounded(
  songbird: &Songbird,
  http: &Http,
  guild: NonZeroU64,
  settings: &VoiceSettings,
  guilds: &mut Guilds,
) -> bool {
  let result = tokio::time::timeout(
    Duration::from_secs(30),
    apply(songbird, http, guild, settings, guilds),
  )
  .await;
  match result {
    Ok(Ok(())) => true,
    Ok(Err(error)) => {
      tracing::warn!(name: "voice.settings.failed", %guild, error = %format_args!("{error:#}"), message = "could not apply voice settings");
      false
    }
    Err(_) => {
      tracing::warn!(%guild, "timed out applying voice settings");
      false
    }
  }
}

/// Reconciles one guild's gateway membership, status, and media connection.
///
/// A cleared selection removes the existing voice connection. A call that is already in the
/// selected channel with gateway connection details and a working media connection is kept;
/// only its status is refreshed. Otherwise the worker joins, applies status after Discord
/// confirms gateway membership, and waits for media separately. Media failures are logged
/// without undoing the join and make the next pass join again.
///
/// # Errors
///
/// Returns gateway join, mute, leave, or status-update errors. Gateway changes may already be
/// applied. Media-driver failures are logged and retried later without undoing membership.
async fn apply(
  songbird: &Songbird,
  http: &Http,
  guild: NonZeroU64,
  settings: &VoiceSettings,
  guilds: &mut Guilds,
) -> anyhow::Result<()> {
  let id = GuildId(guild);
  let (current, has_connection) = match songbird.get(id) {
    Some(call) => {
      let call = call.lock().await;
      (
        call.current_channel().map(|channel| channel.0),
        call.current_connection().is_some(),
      )
    }
    None => (None, false),
  };
  let channel = match connection_change(current, settings.channel()) {
    ConnectionChange::Keep => {
      guilds.statuses.remove(&guild);
      guilds.connected.remove(&guild);
      return Ok(());
    }
    ConnectionChange::Disconnect => {
      guilds.connected.remove(&guild);
      songbird
        .remove(id)
        .await
        .context("Discord voice leave failed")?;
      guilds.statuses.remove(&guild);
      return Ok(());
    }
    ConnectionChange::Join(channel) => channel,
  };

  if current == Some(channel) && has_connection && guilds.connected.contains(&guild) {
    return apply_status(
      http,
      guild,
      channel,
      settings.status(),
      &mut guilds.statuses,
    )
    .await;
  }
  guilds.connected.remove(&guild);
  if current != Some(channel) {
    songbird.get_or_insert(id).lock().await.mute(true).await?;
    guilds.statuses.remove(&guild);
  }

  let (info, call) = songbird
    .join_gateway(id, VoiceChannelId(channel))
    .await
    .context("Discord did not confirm the voice channel join")?;
  let driver = call.lock().await.connect(info);

  // Discord channel status requires gateway membership. The media driver can finish separately.
  apply_status(
    http,
    guild,
    channel,
    settings.status(),
    &mut guilds.statuses,
  )
  .await?;

  // Media completion cannot undo the already confirmed gateway membership or status.
  if report_media(guild, wait_for_media(driver).await) {
    guilds.connected.insert(guild);
  }
  Ok(())
}

/// Records media failure independently from the confirmed gateway membership.
///
/// Returns whether the media connection is working.
fn report_media(guild: NonZeroU64, result: anyhow::Result<()>) -> bool {
  match result {
    Ok(()) => true,
    Err(error) => {
      tracing::warn!(%guild,%error, message = "voice media connection failed");
      false
    }
  }
}
#[derive(Serialize)]
struct VoiceStatus<'a> {
  status: &'a str,
}

/// Waits for media transport independently of the already confirmed gateway membership.
///
/// # Errors
///
/// Returns the transport failure, or an error if connection takes longer than eight seconds.
async fn wait_for_media<E>(driver: impl Future<Output = Result<(), E>>) -> anyhow::Result<()>
where
  E: std::error::Error + Send + Sync + 'static,
{
  tokio::time::timeout(Duration::from_secs(8), driver)
    .await
    .context("voice media connection timed out")?
    .map_err(anyhow::Error::new)
}

/// Sends changed status text and records it only after Discord accepts the request.
///
/// The cache key includes the guild and channel. `None` clears the local record and skips
/// the HTTP call, so a later enabled preference can be sent again.
///
/// # Errors
///
/// Returns an error if Discord rejects the status update or it exceeds eight seconds.
/// The cache is updated only after a successful response.
async fn apply_status(
  http: &Http,
  guild: NonZeroU64,
  channel: NonZeroU64,
  status: Option<&str>,
  known_statuses: &mut HashMap<NonZeroU64, (NonZeroU64, String)>,
) -> anyhow::Result<()> {
  let Some(status) = status else {
    known_statuses.remove(&guild);
    return Ok(());
  };
  if known_statuses
    .get(&guild)
    .is_some_and(|(id, text)| *id == channel && text == status)
  {
    return Ok(());
  }
  tokio::time::timeout(
    Duration::from_secs(8),
    http.edit_voice_status(ChannelId::new(channel.get()), &VoiceStatus { status }, None),
  )
  .await
  .context("Discord voice status request timed out")?
  .context("Discord rejected the voice channel status update")?;
  known_statuses.insert(guild, (channel, status.to_owned()));
  tracing::info!(%guild, %channel, message = "voice channel status set");
  Ok(())
}

#[cfg(test)]
mod tests;
#[cfg(test)]
use botge_storage::Store;

#[cfg(test)]
use botge_test_support as test_support;

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
