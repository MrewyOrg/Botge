//! Reads and saves guild voice preferences after checking live Discord channel permissions.

use std::sync::Arc;

use axum::{Json, extract::State, http::HeaderMap};
use serde::{Deserialize, Serialize};

use super::{Activity, ApiError, GuildAccess, ReadSettings, VoiceChannel};
use crate::settings::VoiceSettings;

/// A full replacement for one guild's voice settings.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SaveSettings {
  guild_id: String,
  #[serde(default)]
  code: String,
  voice: VoiceSettings,
}

/// Saved voice preferences paired with the live channel choices.
#[derive(Serialize)]
pub(super) struct SettingsResponse {
  voice: VoiceSettings,
  channels: Vec<VoiceChannel>,
}

/// Returns the saved voice preference and the channels the bot can currently join.
///
/// Discord supplies the current channel list after checking administrator access. The saved
/// selection can still name a channel that was removed or that Botge can no longer join.
///
/// # Errors
///
/// Returns input, proxy, admission, Discord authorization, or database errors. A stale saved
/// channel remains in the saved preference rather than causing a read failure.
pub(super) async fn read_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<SettingsResponse>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let channels = state.channels(guild, &credential).await?;
  let store = Arc::clone(&state.store);
  let voice = tokio::task::spawn_blocking(move || store.voice_settings(guild))
    .await
    .map_err(ApiError::internal)?
    .map_err(ApiError::internal)?;
  Ok(Json(SettingsResponse { voice, channels }))
}

/// Persists a joinable channel or a cleared selection and wakes the voice worker.
///
/// A channel ID must appear in the list returned by Discord for this request. Clearing the
/// channel allows the status text and toggle to be saved independently. The notification is
/// sent after the transaction commits, and the response confirms the saved preference.
/// The asynchronous worker applies the change to Discord separately.
///
/// # Errors
///
/// Returns validation, proxy, admission, authorization, or database errors. A selected channel
/// must be currently joinable. The voice worker is notified only after persistence succeeds.
pub(super) async fn save_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<SaveSettings>,
) -> Result<Json<SettingsResponse>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  if !request.voice.is_valid() {
    return Err(ApiError::INVALID);
  }
  let channels = state.channels(guild, &credential).await?;
  if request
    .voice
    .channel_id
    .as_ref()
    .is_some_and(|id| !channels.iter().any(|channel| channel.id == *id))
  {
    return Err(ApiError::INVALID);
  }
  let store = Arc::clone(&state.store);
  let saved = request.voice;
  let voice = tokio::task::spawn_blocking(move || {
    store.save_voice_settings(guild, &saved)?;
    Ok::<_, anyhow::Error>(saved)
  })
  .await
  .map_err(ApiError::internal)?
  .map_err(ApiError::internal)?;
  state.voice_changed.notify_one();
  Ok(Json(SettingsResponse { voice, channels }))
}

#[cfg(test)]
mod tests;
