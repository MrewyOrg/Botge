// cspell:words healthz

//! Activity HTTP handlers for Discord-authenticated settings and catalog operations.
//!
//! Requests carry Discord proxy signature headers and an Activity OAuth code. The signature
//! authenticates the proxy request. The OAuth code identifies the caller, whose guild membership
//! and permissions are checked separately for operations scoped to a guild. Border preferences
//! belong to the authenticated user across guilds. The health route only reports HTTP readiness.

use std::{
  future::Future,
  num::NonZeroU64,
  sync::Arc,
  time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
  Json, Router,
  extract::{DefaultBodyLimit, State},
  http::{HeaderMap, StatusCode, header},
  response::{IntoResponse, Response},
  routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tokio::sync::{Notify, Semaphore};

use crate::{
  emotes::{Emote, Emotes, GuildEmotes, browser_catalog, valid_seven_id},
  proxy::ProxyAuthenticator,
  settings::{VoiceSettings, discord_id},
  storage::Store,
};

/// A voice channel the Activity can offer as a join target.
#[derive(Serialize)]
pub(crate) struct VoiceChannel {
  pub(crate) id: String,
  pub(crate) name: String,
}

/// A guild role ID and label for the emote manager picker.
#[derive(Serialize)]
pub(crate) struct GuildRole {
  pub(crate) id: String,
  pub(crate) name: String,
}

/// The caller's guild membership and the roles offered in the settings picker.
pub(crate) struct Membership {
  pub(crate) administrator: bool,
  pub(crate) roles: Vec<String>,
  /// Selectable guild roles. This is empty for callers without administrator access.
  pub(crate) available_roles: Vec<GuildRole>,
}

/// Resolves Discord identity and guild access from the Activity's OAuth code.
pub(crate) trait GuildAccess: Send + Sync + 'static {
  /// Returns the authenticated account ID for a user-scoped operation.
  fn user_id(&self, code: &str) -> impl Future<Output = Result<NonZeroU64, ApiError>> + Send;

  /// Resolves the caller's current membership, role IDs, and administrator status in `guild`.
  fn membership(
    &self,
    guild: NonZeroU64,
    code: &str,
  ) -> impl Future<Output = Result<Membership, ApiError>> + Send;

  /// Requires the caller to administer `guild` and returns the channels Botge can join.
  fn voice_channels(
    &self,
    guild: NonZeroU64,
    code: &str,
  ) -> impl Future<Output = Result<Vec<VoiceChannel>, ApiError>> + Send;
}

/// Shared dependencies and the request limit for a single Activity API instance.
struct Activity<A> {
  access: A,
  proxy: ProxyAuthenticator,
  store: Arc<Store>,
  emotes: Arc<Emotes>,
  voice_changed: Arc<Notify>,
  slots: Semaphore,
}

/// An HTTP status and a client-safe message. Upstream details stay in the logs.
pub(crate) struct ApiError(StatusCode, &'static str);

impl ApiError {
  pub(crate) const UNAUTHORIZED: Self = Self(
    StatusCode::UNAUTHORIZED,
    "Discord authorization expired. Try again.",
  );
  pub(crate) const OAUTH_CONFIGURATION: Self = Self(
    StatusCode::BAD_GATEWAY,
    "Discord rejected Botge's OAuth configuration. Check the application ID and Activity client secret.",
  );
  pub(crate) const FORBIDDEN: Self = Self(
    StatusCode::FORBIDDEN,
    "Only the server owner or an administrator can manage voice settings.",
  );
  pub(crate) const NOT_MEMBER: Self = Self(
    StatusCode::FORBIDDEN,
    "Could not verify your server membership.",
  );
  const INVALID: Self = Self(StatusCode::BAD_REQUEST, "Invalid Activity request.");

  /// Logs an upstream failure and returns a generic gateway error to the Activity.
  pub(crate) fn upstream(error: impl std::fmt::Display) -> Self {
    tracing::warn!(%error, "Discord request failed");
    Self(
      StatusCode::BAD_GATEWAY,
      "Discord is unavailable. Try again shortly.",
    )
  }

  /// Logs a local failure while keeping its details out of the HTTP response.
  fn internal(error: impl std::fmt::Display) -> Self {
    tracing::error!(%error, "could not access voice settings");
    Self(
      StatusCode::INTERNAL_SERVER_ERROR,
      "Could not access voice settings.",
    )
  }
}

impl IntoResponse for ApiError {
  /// Sends the error status with the JSON message shape used by the Activity.
  fn into_response(self) -> Response {
    let body = if self.1 == Self::UNAUTHORIZED.1 {
      serde_json::json!({ "message": self.1, "code": "oauth_expired" })
    } else {
      serde_json::json!({ "message": self.1 })
    };
    (self.0, Json(body)).into_response()
  }
}

/// The guild context and authorization code supplied to Activity reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadSettings {
  guild_id: String,
  code: String,
}

/// A full replacement for one guild's voice settings.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveSettings {
  guild_id: String,
  code: String,
  voice: VoiceSettings,
}

/// Saved voice preferences paired with the live channel choices.
#[derive(Serialize)]
struct SettingsResponse {
  voice: VoiceSettings,
  channels: Vec<VoiceChannel>,
}

/// Builds the Activity router with shared storage, emote resolution, and Discord access.
///
/// The Activity posts JSON containing its OAuth code even for reads. These responses carry
/// `Cache-Control: no-store` because permissions and preferences depend on the current caller.
/// The body limit and the per-handler concurrency limit bound separate parts of request work.
pub(crate) fn router<A: GuildAccess>(
  store: Arc<Store>,
  emotes: Arc<Emotes>,
  voice_changed: Arc<Notify>,
  proxy: ProxyAuthenticator,
  access: A,
) -> Router {
  Router::new()
    .route("/healthz", get(|| async { StatusCode::NO_CONTENT }))
    .route("/settings", post(read_settings::<A>))
    .route("/settings/voice", post(save_settings::<A>))
    .route("/catalog", post(read_catalog::<A>))
    .route("/emotes", post(add_emote::<A>))
    .route("/emotes/remove", post(remove_emote::<A>))
    .route("/emotes/batch", post(change_emotes::<A>))
    .route("/settings/emotes", post(save_emote_settings::<A>))
    .route("/settings/emotes/read", post(read_emote_settings::<A>))
    .route("/settings/border", post(save_border::<A>))
    .route("/settings/border/read", post(read_border::<A>))
    .layer(DefaultBodyLimit::max(4096))
    .layer(axum::middleware::map_response(
      |mut response: Response| async {
        response.headers_mut().insert(
          header::CACHE_CONTROL,
          header::HeaderValue::from_static("no-store"),
        );
        response
      },
    ))
    .with_state(Arc::new(Activity {
      access,
      proxy,
      store,
      emotes,
      voice_changed,
      slots: Semaphore::new(8),
    }))
}

impl<A: GuildAccess> Activity<A> {
  /// Checks the proxy signature and request shape before reserving a concurrency slot.
  ///
  /// Keep the returned permit alive for the rest of the handler. It reserves one slot while
  /// the handler contacts Discord, looks up emotes, or reads and writes preferences.
  ///
  /// # Errors
  ///
  /// An invalid signature yields 401. A malformed guild ID or code yields 400. A full
  /// semaphore yields 503 immediately, so a burst of requests cannot queue inside the API.
  fn validate(
    &self,
    headers: &HeaderMap,
    guild: &str,
    code: &str,
  ) -> Result<(NonZeroU64, tokio::sync::SemaphorePermit<'_>), ApiError> {
    let now = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map_err(ApiError::internal)?
      .as_secs();
    if !self.proxy.verify(headers, now) {
      return Err(ApiError(
        StatusCode::UNAUTHORIZED,
        "Discord Activity proxy authentication failed.",
      ));
    }
    let guild = discord_id(guild).ok_or(ApiError::INVALID)?;
    if code.is_empty()
      || code.len() > 512
      || !code
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
      return Err(ApiError::INVALID);
    }
    let permit = self.slots.try_acquire().map_err(|_| {
      ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Botge is busy. Try again shortly.",
      )
    })?;
    Ok((guild, permit))
  }

  /// Caps the time spent resolving the caller's guild membership.
  async fn member(&self, guild: NonZeroU64, code: &str) -> Result<Membership, ApiError> {
    tokio::time::timeout(Duration::from_secs(20), self.access.membership(guild, code))
      .await
      .map_err(ApiError::upstream)?
  }

  /// Caps the administrator and bot permission lookups needed for the channel picker.
  async fn channels(&self, guild: NonZeroU64, code: &str) -> Result<Vec<VoiceChannel>, ApiError> {
    tokio::time::timeout(
      Duration::from_secs(25),
      self.access.voice_channels(guild, code),
    )
    .await
    .map_err(ApiError::upstream)?
  }
}

/// Returns the saved voice preference and the channels the bot can currently join.
///
/// Discord supplies the current channel list after checking administrator access. The saved
/// selection can still name a channel that was removed or that Botge can no longer join.
async fn read_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<SettingsResponse>, ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let channels = state.channels(guild, &request.code).await?;
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
async fn save_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<SaveSettings>,
) -> Result<Json<SettingsResponse>, ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  if !request.voice.is_valid() {
    return Err(ApiError::INVALID);
  }
  let channels = state.channels(guild, &request.code).await?;
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

/// A single-emote mutation identified by a 7TV ID.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChangeEmote {
  guild_id: String,
  code: String,
  emote_id: String,
}

/// A full replacement for the guild's emote feeds and access rules.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveEmoteSettings {
  guild_id: String,
  code: String,
  emotes: GuildEmotes,
}

/// Returns the browser catalog and the capabilities available to the current member.
///
/// A member can browse the guild's enabled feeds regardless of whether they can manage its
/// individual additions. The response flags let the browser decide which actions to offer.
/// Mutation handlers recheck those permissions against current settings.
async fn read_catalog<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let member = state.member(guild, &request.code).await?;
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
async fn add_emote<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ChangeEmote>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  if !valid_seven_id(&request.emote_id) {
    return Err(ApiError::INVALID);
  }
  state.authorize_change(guild, &request.code).await?;
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
async fn remove_emote<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ChangeEmote>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  if !valid_seven_id(&request.emote_id) {
    return Err(ApiError::INVALID);
  }
  state.authorize_change(guild, &request.code).await?;
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
struct ChangeEmotes {
  guild_id: String,
  code: String,
  action: EmoteAction,
  emote_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
/// The outcome of one item in a batch, kept in the original request order.
struct EmoteChange {
  emote_id: String,
  ok: bool,
  message: String,
}

/// Authorizes the batch once and reports success or failure for each item.
///
/// The request must contain one to twelve valid, distinct IDs. After authorization, the
/// response contains one result per ID in request order. Each successful change is committed
/// independently, so callers can retry the failed items without repeating the whole batch.
async fn change_emotes<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ChangeEmotes>,
) -> Result<Json<Vec<EmoteChange>>, ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
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
  state.authorize_change(guild, &request.code).await?;
  let mut results = Vec::with_capacity(request.emote_ids.len());
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
  async fn emote_settings(&self, guild: NonZeroU64) -> Result<GuildEmotes, ApiError> {
    let store = Arc::clone(&self.store);
    database(move || store.guild_emotes(guild)).await
  }

  /// Distinguishes a missing 7TV emote from a failed upstream request.
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
  async fn authorize_change(&self, guild: NonZeroU64, code: &str) -> Result<(), ApiError> {
    if !self.emotes.added_emotes_enabled() {
      return Err(ApiError(
        StatusCode::FORBIDDEN,
        "Added 7TV emotes are disabled by the operator.",
      ));
    }
    let member = self.member(guild, code).await?;
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
  async fn authorize_settings(
    &self,
    guild: NonZeroU64,
    code: &str,
  ) -> Result<Vec<GuildRole>, ApiError> {
    let member = self.member(guild, code).await?;
    if !member.administrator {
      return Err(ApiError(
        StatusCode::FORBIDDEN,
        "Only a server administrator can change emote settings.",
      ));
    }
    Ok(member.available_roles)
  }
}

/// Runs a synchronous redb operation off the async executor and maps failures for HTTP.
async fn database<T: Send + 'static>(
  work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, ApiError> {
  tokio::task::spawn_blocking(work)
    .await
    .map_err(ApiError::internal)?
    .map_err(ApiError::internal)
}

/// Saved emote policy with the live roles available for the manager picker.
#[derive(Serialize)]
struct EmoteSettingsResponse {
  #[serde(flatten)]
  emotes: GuildEmotes,
  roles: Vec<GuildRole>,
}

/// Returns saved emote settings and the administrator's current role choices for the picker.
async fn read_emote_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<EmoteSettingsResponse>, ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let roles = state.authorize_settings(guild, &request.code).await?;
  Ok(Json(EmoteSettingsResponse {
    emotes: state.emote_settings(guild).await?,
    roles,
  }))
}

/// Validates and replaces the guild's provider selections and manager access rules.
///
/// The submitted object is a full replacement. The response includes the saved values and
/// the role choices available to the administrator for refreshing the form.
async fn save_emote_settings<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<SaveEmoteSettings>,
) -> Result<Json<EmoteSettingsResponse>, ApiError> {
  let (guild, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let roles = state.authorize_settings(guild, &request.code).await?;
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

/// A border update for the OAuth caller, with an empty color representing a clear.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveBorder {
  guild_id: String,
  code: String,
  color: String,
}

/// Parses a six-digit RGB color with an optional `#`. Blank input clears the preference.
fn parse_border(color: &str) -> Result<Option<u32>, ApiError> {
  let color = color.trim();
  let color = color.strip_prefix('#').unwrap_or(color);
  match color {
    "" => Ok(None),
    hex if hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
      u32::from_str_radix(hex, 16)
        .map(Some)
        .map_err(|_| ApiError::INVALID)
    }
    _ => Err(ApiError(
      StatusCode::BAD_REQUEST,
      "Enter a six-digit hex color or leave it blank.",
    )),
  }
}

/// Resolves the caller's account for a preference shared across guilds.
async fn border_user<A: GuildAccess>(
  state: &Activity<A>,
  code: &str,
) -> Result<NonZeroU64, ApiError> {
  tokio::time::timeout(Duration::from_secs(20), state.access.user_id(code))
    .await
    .map_err(ApiError::upstream)?
}

/// Serializes the preference as uppercase hex without a leading `#`, or an empty string.
fn border_response(color: Option<u32>) -> Json<serde_json::Value> {
  Json(
    serde_json::json!({ "color": color.map_or_else(String::new, |color| format!("{color:06X}")) }),
  )
}

/// Loads the authenticated user's border preference for use across guilds.
async fn read_border<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (_, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let user = border_user(&state, &request.code).await?;
  let store = Arc::clone(&state.store);
  Ok(border_response(
    database(move || store.emote_border(user)).await?,
  ))
}

/// Replaces or clears the authenticated user's border preference.
///
/// The owner comes from Discord's OAuth response. The request cannot select another user.
async fn save_border<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<SaveBorder>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (_, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let user = border_user(&state, &request.code).await?;
  let color = parse_border(&request.color)?;
  let store = Arc::clone(&state.store);
  database(move || store.save_emote_border(user, color)).await?;
  Ok(border_response(color))
}

#[cfg(test)]
mod tests;
