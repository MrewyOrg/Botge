use std::{collections::HashMap, num::NonZeroU64, sync::Arc, time::Duration};

use anyhow::Context as _;
use serenity::{all::ChannelId, http::Http};
use songbird::{
  Songbird,
  id::{ChannelId as VoiceChannelId, GuildId},
};
use tokio::sync::{Notify, watch};

use crate::{settings::VoiceSettings, storage::Store};

#[derive(Debug, Eq, PartialEq)]
/// The gateway action needed for the guild's saved channel selection.
enum ConnectionChange {
  Keep,
  Join(NonZeroU64),
  Disconnect,
}

/// Chooses whether to apply a join, leave an existing call, or leave the guild idle.
fn connection_change(current: Option<NonZeroU64>, desired: Option<NonZeroU64>) -> ConnectionChange {
  if let Some(channel) = desired {
    // Reapply the join even for the selected channel so the driver can recover.
    ConnectionChange::Join(channel)
  } else if current.is_some() {
    ConnectionChange::Disconnect
  } else {
    ConnectionChange::Keep
  }
}

/// Waits for the gateway to be ready, then applies saved channel and status settings.
///
/// Settings changes and gateway notifications wake the worker. A periodic pass retries
/// transient failures, and a timeout per guild keeps one slow connection from blocking
/// the others indefinitely. The worker exits if the gateway closes before becoming ready.
pub(crate) async fn reconcile(
  store: Arc<Store>,
  songbird: Arc<Songbird>,
  http: Arc<Http>,
  changed: Arc<Notify>,
  mut ready: watch::Receiver<bool>,
) {
  if ready.wait_for(|ready| *ready).await.is_err() {
    return;
  }
  let mut known_statuses = HashMap::new();
  let mut periodic = tokio::time::interval(Duration::from_secs(60));
  periodic.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
  loop {
    tokio::select! {
        _ = changed.notified() => (),
        _ = periodic.tick() => (),
    }
    let store = Arc::clone(&store);
    let settings = match tokio::task::spawn_blocking(move || store.all_voice_settings()).await {
      Ok(Ok(settings)) => settings,
      Ok(Err(error)) => {
        tracing::error!(%error, "could not read saved voice settings");
        continue;
      }
      Err(error) => {
        tracing::error!(%error, "voice settings task failed");
        continue;
      }
    };
    for (guild, settings) in settings {
      let result = tokio::time::timeout(
        Duration::from_secs(30),
        apply(&songbird, &http, guild, &settings, &mut known_statuses),
      )
      .await;
      match result {
        Ok(Ok(())) => (),
        Ok(Err(error)) => {
          tracing::warn!(%guild, "could not apply voice settings: {error:#}")
        }
        Err(_) => tracing::warn!(%guild, "timed out applying voice settings"),
      }
    }
  }
}

/// Reconciles one guild's gateway membership, status, and media connection.
///
/// A cleared selection removes the existing voice connection. When joining, status is
/// applied after Discord confirms gateway membership, while media setup can finish or
/// retry separately. Media failures are logged without undoing the join.
async fn apply(
  songbird: &Songbird,
  http: &Http,
  guild: NonZeroU64,
  settings: &VoiceSettings,
  known_statuses: &mut HashMap<NonZeroU64, (NonZeroU64, String)>,
) -> anyhow::Result<()> {
  let id = GuildId(guild);
  let current = match songbird.get(id) {
    Some(call) => call.lock().await.current_channel().map(|channel| channel.0),
    None => None,
  };
  let channel = match connection_change(current, settings.channel()) {
    ConnectionChange::Keep => {
      known_statuses.remove(&guild);
      return Ok(());
    }
    ConnectionChange::Disconnect => {
      songbird
        .remove(id)
        .await
        .context("Discord voice leave failed")?;
      known_statuses.remove(&guild);
      return Ok(());
    }
    ConnectionChange::Join(channel) => channel,
  };

  if current != Some(channel) {
    songbird.get_or_insert(id).lock().await.mute(true).await?;
    known_statuses.remove(&guild);
  }

  let (info, call) = songbird
    .join_gateway(id, VoiceChannelId(channel))
    .await
    .context("Discord did not confirm the voice channel join")?;
  let driver = call.lock().await.connect(info);

  // Discord channel status requires gateway membership. The media driver can finish separately.
  apply_status(http, guild, channel, settings.status(), known_statuses).await?;

  // Preserve the gateway membership and status if the media transport needs another retry.
  match tokio::time::timeout(Duration::from_secs(8), driver).await {
    Ok(Ok(())) => (),
    Ok(Err(error)) => tracing::warn!(%guild, %error, "voice media connection failed"),
    Err(_) => tracing::warn!(%guild, "voice media connection timed out"),
  }
  Ok(())
}

/// Sends changed status text and records it only after Discord accepts the request.
///
/// The cache key includes the guild and channel. `None` clears the local record and skips
/// the HTTP call, so a later enabled preference can be sent again.
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
    http.edit_voice_status(
      ChannelId::new(channel.get()),
      &serde_json::json!({ "status": status }),
      None,
    ),
  )
  .await
  .context("Discord voice status request timed out")?
  .context("Discord rejected the voice channel status update")?;
  known_statuses.insert(guild, (channel, status.to_owned()));
  tracing::info!(%guild, %channel, "voice channel status set");
  Ok(())
}

#[cfg(test)]
mod tests;
