//! Reads guild emote catalogs and authorizes individual additions, batches, and feed settings.

use std::{num::NonZeroU64, sync::Arc};

use axum::{
  Json,
  extract::State,
  http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};

use super::{Activity, ApiError, Credential, GuildAccess, GuildRole, ReadSettings, database};
use crate::emotes::{Emote, GuildEmotes, browser_catalog, valid_seven_id};

/// A single-emote mutation identified by a 7TV ID.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ChangeEmote {
  guild_id: String,
  #[serde(default)]
  code: String,
  emote_id: String,
}

/// A full replacement for the guild's emote feeds and access rules.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SaveEmoteSettings {
  guild_id: String,
  #[serde(default)]
  code: String,
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
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let member = state.member(guild, &credential).await?;
  let settings = state.emote_settings(guild).await?;
  let entries = state
    .emotes
    .catalog(Some(guild))
    .await
    .map_err(ApiError::internal)?;
  let added_emotes_enabled = state.emotes.added_emotes_enabled();
  let manage = added_emotes_enabled && settings.can_manage(member.administrator, &member.roles);
  Ok(Json(serde_json::json!({
      "message": "Server emotes loaded.", "emotes": browser_catalog(&entries),
      "canManageEmotes": manage, "canComposeDiscovery": added_emotes_enabled
  })))
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
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  if !valid_seven_id(&request.emote_id) {
    return Err(ApiError::INVALID);
  }
  state.authorize_change(guild, &credential).await?;
  let emote = state.lookup_emote(&request.emote_id).await?;
  let catalog = state
    .emotes
    .catalog(Some(guild))
    .await
    .map_err(ApiError::internal)?;
  let message = state.add_to_catalog(guild, emote, &catalog).await?;
  Ok((
    StatusCode::CREATED,
    Json(serde_json::json!({ "message": message, "added": true })),
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
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  if !valid_seven_id(&request.emote_id) {
    return Err(ApiError::INVALID);
  }
  state.authorize_change(guild, &credential).await?;
  state.remove_from_catalog(guild, request.emote_id).await?;
  Ok(Json(
    serde_json::json!({ "message": "Removed emote.", "removed": true }),
  ))
}

/// The operation applied to every ID in a batch request.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum EmoteAction {
  Add,
  Remove,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// One operation applied to a batch of distinct 7TV IDs.
pub(super) struct ChangeEmotes {
  guild_id: String,
  #[serde(default)]
  code: String,
  action: EmoteAction,
  emote_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// The outcome of one item in a batch, kept in the original request order.
pub(super) struct EmoteChange {
  emote_id: String,
  ok: bool,
  message: String,
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
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let mut seen = std::collections::HashSet::new();
  if request.emote_ids.is_empty()
    || request.emote_ids.len() > 12
    || !request
      .emote_ids
      .iter()
      .all(|id| valid_seven_id(id) && seen.insert(id))
  {
    return Err(ApiError::INVALID);
  }
  state.authorize_change(guild, &credential).await?;
  // The validated batch contains at most twelve entries.
  let mut results = Vec::with_capacity(12);
  match request.action {
    EmoteAction::Add => {
      // Load the catalog once. Each write still checks the current saved additions in redb.
      let (catalog, emotes) = tokio::join!(
        state.emotes.catalog(Some(guild)),
        futures_util::future::join_all(request.emote_ids.iter().map(|id| state.lookup_emote(id)))
      );
      let catalog = catalog.map_err(ApiError::internal)?;
      for (id, emote) in request.emote_ids.into_iter().zip(emotes) {
        let result = match emote {
          Ok(emote) => state.add_to_catalog(guild, emote, &catalog).await,
          Err(error) => Err(error),
        };
        results.push(emote_change(id, result));
      }
    }
    EmoteAction::Remove => {
      for id in request.emote_ids {
        let result = state
          .remove_from_catalog(guild, id.clone())
          .await
          .map(|()| "Removed emote.".to_owned());
        results.push(emote_change(id, result));
      }
    }
  }
  Ok(Json(results))
}

/// Converts one item's result to the batch response without changing the HTTP status.
fn emote_change(emote_id: String, result: Result<String, ApiError>) -> EmoteChange {
  let ok = result.is_ok();
  let message = result.unwrap_or_else(|error| error.1.to_owned());
  EmoteChange {
    emote_id,
    ok,
    message,
  }
}

impl<A: GuildAccess> Activity<A> {
  /// Loads the guild's saved emote policy on the blocking pool.
  ///
  /// # Errors
  ///
  /// Returns an internal API error if the blocking database task or saved policy read fails.
  async fn emote_settings(&self, guild: NonZeroU64) -> Result<GuildEmotes, ApiError> {
    let store = Arc::clone(&self.store);
    database(move || store.guild_emotes(guild)).await
  }

  /// Distinguishes a missing 7TV emote from a failed upstream request.
  ///
  /// # Errors
  ///
  /// Returns not-found for an unavailable emote, or a gateway error for provider lookup failures.
  async fn lookup_emote(&self, id: &str) -> Result<Emote, ApiError> {
    self
      .emotes
      .fetch_added(id)
      .await
      .map_err(|error| {
        tracing::warn!(%error, "7TV emote lookup failed");
        ApiError(StatusCode::BAD_GATEWAY, "7TV is unavailable. Try again.")
      })?
      .ok_or(ApiError(
        StatusCode::NOT_FOUND,
        "Could not find that 7TV emote.",
      ))
  }

  /// Checks the catalog snapshot for conflicts, then lets storage enforce atomic insertion.
  ///
  /// The catalog check catches collisions with provider entries. The redb transaction checks
  /// the latest saved additions again, including additions made since the snapshot was loaded.
  ///
  /// # Errors
  ///
  /// Returns a conflict for a duplicate or full catalog, or an internal error for database
  /// failures. The stored list is checked atomically even when the snapshot is stale.
  async fn add_to_catalog(
    &self,
    guild: NonZeroU64,
    emote: Emote,
    catalog: &[Emote],
  ) -> Result<String, ApiError> {
    if catalog.iter().any(|entry| {
      entry.name.eq_ignore_ascii_case(&emote.name)
        || (entry.source == emote.source && entry.id == emote.id)
    }) {
      return Err(ApiError(
        StatusCode::CONFLICT,
        "This emote or its name is already in the catalog.",
      ));
    }
    let store = Arc::clone(&self.store);
    let message = format!("Added emote {}.", emote.name);
    if !database(move || store.add_emote(guild, emote)).await? {
      return Err(ApiError(
        StatusCode::CONFLICT,
        "The added emote already exists or the catalog is full.",
      ));
    }
    Ok(message)
  }

  /// Removes a stored addition and reports 404 when the guild has no matching row entry.
  ///
  /// # Errors
  ///
  /// Returns not-found if the ID is not individually added, or an internal database/task error.
  async fn remove_from_catalog(&self, guild: NonZeroU64, id: String) -> Result<(), ApiError> {
    let store = Arc::clone(&self.store);
    if !database(move || store.remove_emote(guild, &id)).await? {
      return Err(ApiError(
        StatusCode::NOT_FOUND,
        "This emote is not individually added.",
      ));
    }
    Ok(())
  }

  /// Checks the operator switch and guild rules before allowing individual emote changes.
  ///
  /// When individual additions are enabled, access comes from administrator privileges, the
  /// guild's everyone setting, or a role listed in the saved manager rules.
  ///
  /// # Errors
  ///
  /// Returns a denial when the operator disables additions or the current member lacks the
  /// saved guild permissions. Credential, lookup, deadline, and database errors propagate.
  async fn authorize_change(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<(), ApiError> {
    if !self.emotes.added_emotes_enabled() {
      return Err(ApiError(
        StatusCode::FORBIDDEN,
        "Added 7TV emotes are disabled by the operator.",
      ));
    }
    let member = self.member(guild, credential).await?;
    if !self
      .emote_settings(guild)
      .await?
      .can_manage(member.administrator, &member.roles)
    {
      return Err(ApiError(
        StatusCode::FORBIDDEN,
        "You do not have permission to manage added emotes.",
      ));
    }
    Ok(())
  }

  /// Requires administrator access and returns the roles that can be shown in settings.
  ///
  /// # Errors
  ///
  /// Returns an error if current membership cannot be verified or the caller is not an
  /// administrator.
  async fn authorize_settings(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Vec<GuildRole>, ApiError> {
    let member = self.member(guild, credential).await?;
    if !member.administrator {
      return Err(ApiError(
        StatusCode::FORBIDDEN,
        "Only a server administrator can change emote settings.",
      ));
    }
    Ok(member.available_roles)
  }
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
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let roles = state.authorize_settings(guild, &credential).await?;
  Ok(Json(EmoteSettingsResponse {
    emotes: state.emote_settings(guild).await?,
    roles,
  }))
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
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let roles = state.authorize_settings(guild, &credential).await?;
  if !request.emotes.valid() {
    return Err(ApiError::INVALID);
  }
  let store = Arc::clone(&state.store);
  let settings = database(move || {
    store.save_guild_emotes(guild, &request.emotes)?;
    Ok(request.emotes)
  })
  .await?;
  Ok(Json(EmoteSettingsResponse {
    emotes: settings,
    roles,
  }))
}

#[cfg(test)]
mod tests;
