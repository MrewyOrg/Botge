//! Reads guild emote catalogs and authorizes individual additions, batches, and feed settings.

use std::sync::Arc;

use axum::{
  Json,
  extract::State,
  http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};

use super::{Activity, ApiError, GuildAccess, GuildRole, ReadSettings};
use botge_domain::emotes::{GuildEmotes, browser_catalog};

/// A single-emote mutation identified by a 7TV ID.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ChangeEmote {
  guild_id: String,
  emote_id: String,
}

/// A full replacement for the guild's emote feeds and access rules.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SaveEmoteSettings {
  guild_id: String,
  emotes: GuildEmotes,
}

/// Returns the browser catalog and the capabilities available to the current member.
///
/// A member can browse the guild's enabled feeds regardless of whether they can manage its
/// individual additions. The response flags let the browser decide which actions to offer.
/// Mutation handlers recheck those permissions against current settings.
///
/// # Errors
///
/// Returns input, proxy, admission, membership, or database errors. Provider feed outages
/// can produce stale or empty entries rather than failing the request.
pub(super) async fn read_catalog<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let result = state
    .application
    .guild_catalog(&state.access, guild, &credential)
    .await?;
  Ok(Json(
    serde_json::json!({"message":"Server emotes loaded.","emotes":browser_catalog(&result.entries),"canManageEmotes":result.can_manage,"canComposeDiscovery":result.can_compose_discovery}),
  ))
}

/// Adds a 7TV emote to this guild after checking access and catalog conflicts.
///
/// # Errors
///
/// A malformed ID is rejected before the provider lookup. A missing emote yields 404, an
/// upstream lookup failure yields 502, and a duplicate name, duplicate ID, or full list
/// yields 409.
pub(super) async fn add_emote<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ChangeEmote>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let message = state
    .application
    .add_emote(&state.access, guild, &credential, &request.emote_id)
    .await?;
  Ok((
    StatusCode::CREATED,
    Json(serde_json::json!({"message":message,"added":true})),
  ))
}

/// Removes a guild's individual addition by its 7TV ID.
///
/// An ID present only in a provider feed yields 404 because the guild has no saved
/// addition to remove. The provider set is outside this operation's scope.
///
/// # Errors
///
/// Returns validation, authentication, permission, or database errors, including a missing
/// individually added emote. Provider-feed entries are not removed.
pub(super) async fn remove_emote<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ChangeEmote>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  state
    .application
    .remove_emote(&state.access, guild, &credential, request.emote_id)
    .await?;
  Ok(Json(
    serde_json::json!({"message":"Removed emote.","removed":true}),
  ))
}

use botge_app::{EmoteAction, EmoteChange};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// One operation applied to a batch of distinct 7TV IDs.
pub(super) struct ChangeEmotes {
  guild_id: String,
  action: EmoteAction,
  emote_ids: Vec<String>,
}

/// Authorizes the batch once and reports success or failure for each item.
///
/// The request must contain one to twelve valid, distinct IDs. After authorization, the
/// response contains one result per ID in request order. Each successful change is committed
/// independently, so callers can retry the failed items without repeating the whole batch.
///
/// # Errors
///
/// Returns a request-level error for invalid input, failed authentication or authorization,
/// or a failed initial catalog read. Later item failures are encoded in the successful batch
/// response; earlier successful mutations remain committed.
pub(super) async fn change_emotes<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ChangeEmotes>,
) -> Result<Json<Vec<EmoteChange>>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  Ok(Json(
    state
      .application
      .change_emotes(
        &state.access,
        guild,
        &credential,
        request.action,
        request.emote_ids,
      )
      .await?,
  ))
}

/// Saved emote policy with the live roles available for the manager picker.
#[derive(Serialize)]
pub(super) struct EmoteSettingsResponse {
  #[serde(flatten)]
  emotes: GuildEmotes,
  roles: Vec<GuildRole>,
}

/// Returns saved emote settings and the administrator's current role choices for the picker.
///
/// # Errors
///
/// Returns validation, proxy, admission, administrator-access, or saved-policy read errors.
pub(super) async fn read_emote_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<EmoteSettingsResponse>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let (emotes, roles) = state
    .application
    .read_emote_settings(&state.access, guild, &credential)
    .await?;
  Ok(Json(EmoteSettingsResponse { emotes, roles }))
}

/// Validates and replaces the guild's provider selections and manager access rules.
///
/// The submitted object is a full replacement. The response includes the saved values and
/// the role choices available to the administrator for refreshing the form.
///
/// # Errors
///
/// Returns validation, proxy, admission, administrator-access, or persistence errors.
/// Invalid replacements leave the saved policy unchanged.
pub(super) async fn save_emote_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<SaveEmoteSettings>,
) -> Result<Json<EmoteSettingsResponse>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let (emotes, roles) = state
    .application
    .save_emote_settings(&state.access, guild, &credential, request.emotes)
    .await?;
  Ok(Json(EmoteSettingsResponse { emotes, roles }))
}

#[cfg(test)]
mod tests;
