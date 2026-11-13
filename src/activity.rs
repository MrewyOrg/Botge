// cspell:words healthz

//! Activity HTTP handlers for Discord-authenticated settings and catalog operations.
//!
//! Requests carry Discord proxy signature headers and an OAuth bearer token (legacy callers
//! may send a one-use code). The signature authenticates the proxy request. Discord identifies
//! the token holder, whose guild membership and permissions are checked separately for operations
//! scoped to a guild. Border preferences belong to the authenticated user across guilds.
//! The health route only reports HTTP readiness.
//!
//! Shared authentication and request limits live here. [`voice`], [`catalog`], and [`border`]
//! own their route payloads, authorization steps, and persistence operations.

mod border;
mod catalog;
mod voice;

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

use crate::{emotes::Emotes, proxy::ProxyAuthenticator, settings::discord_id, storage::Store};

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

/// A one-use authorization code or an access token obtained from that code.
/// Neither credential is logged or persisted by the API.
pub(crate) enum Credential {
  Code(String),
  AccessToken(String),
}

/// Short-lived browser authentication returned by the code-exchange endpoint.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessToken {
  pub(crate) access_token: String,
  pub(crate) expires_in: u64,
}

/// Resolves Discord identity and guild access from validated Activity credentials.
pub(crate) trait GuildAccess: Send + Sync + 'static {
  /// Exchanges a one-use Discord authorization code for a browser-held access token.
  ///
  /// # Errors
  ///
  /// Returns a client-safe API error when the code is expired or rejected, client credentials
  /// are invalid, or Discord cannot complete the exchange.
  fn exchange_code(&self, code: &str)
  -> impl Future<Output = Result<AccessToken, ApiError>> + Send;

  /// Returns the authenticated account ID for a user-scoped operation.
  ///
  /// # Errors
  ///
  /// Returns an error if the credential cannot identify a valid Discord account.
  fn user_id(
    &self,
    credential: &Credential,
  ) -> impl Future<Output = Result<NonZeroU64, ApiError>> + Send;

  /// Resolves the caller's current membership, role IDs, and administrator status in `guild`.
  ///
  /// # Errors
  ///
  /// Returns an error if identity or current membership cannot be verified for the guild.
  fn membership(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Membership, ApiError>> + Send;

  /// Requires the caller to administer `guild` and returns the channels Botge can join.
  ///
  /// # Errors
  ///
  /// Returns an error if the caller is not an administrator or Discord access and channel
  /// permissions cannot be verified.
  fn voice_channels(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Vec<VoiceChannel>, ApiError>> + Send;
}

/// Shared dependencies and the request limit for a single Activity API instance.
///
/// Handlers validate the proxy and input, authorize through Discord, then use the blocking
/// database helper. A successful settings response confirms persistence, not voice completion.
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

/// Guild context with an optional legacy code; browser requests use a bearer header.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadSettings {
  guild_id: String,
  #[serde(default)]
  code: String,
}

/// Builds the Activity router with shared storage, emote resolution, and Discord access.
///
/// The Activity posts JSON even for reads. These responses carry
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
    .route("/auth", post(authenticate::<A>))
    .route("/settings", post(voice::read_settings::<A>))
    .route("/settings/voice", post(voice::save_settings::<A>))
    .route("/catalog", post(catalog::read_catalog::<A>))
    .route("/emotes", post(catalog::add_emote::<A>))
    .route("/emotes/remove", post(catalog::remove_emote::<A>))
    .route("/emotes/batch", post(catalog::change_emotes::<A>))
    .route("/settings/emotes", post(catalog::save_emote_settings::<A>))
    .route(
      "/settings/emotes/read",
      post(catalog::read_emote_settings::<A>),
    )
    .route("/settings/border", post(border::save_border::<A>))
    .route("/settings/border/read", post(border::read_border::<A>))
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
  /// An invalid signature yields 401. A malformed guild ID or credential yields 400. A full
  /// semaphore yields 503 immediately, so a burst of requests cannot queue inside the API.
  fn validate(
    &self,
    headers: &HeaderMap,
    guild: &str,
    code: &str,
  ) -> Result<(NonZeroU64, Credential, tokio::sync::SemaphorePermit<'_>), ApiError> {
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
    let credential = if let Some(value) = headers.get(header::AUTHORIZATION) {
      let token = value
        .to_str()
        .ok()
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|token| {
          !token.is_empty()
            && token.len() <= 2048
            && token.bytes().all(|byte| {
              byte.is_ascii_alphanumeric()
                || matches!(byte, b'_' | b'-' | b'.' | b'~' | b'+' | b'/' | b'=')
            })
        })
        .ok_or(ApiError::INVALID)?;
      Credential::AccessToken(token.to_owned())
    } else {
      if code.is_empty()
        || code.len() > 512
        || !code
          .bytes()
          .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
      {
        return Err(ApiError::INVALID);
      }
      Credential::Code(code.to_owned())
    };
    let permit = self.slots.try_acquire().map_err(|_error| {
      ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Botge is busy. Try again shortly.",
      )
    })?;
    Ok((guild, credential, permit))
  }

  /// Caps the time spent resolving the caller's guild membership.
  ///
  /// # Errors
  ///
  /// Returns credential or membership errors from [`GuildAccess::membership`], or an upstream
  /// error when the 20-second lookup deadline expires.
  async fn member(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Membership, ApiError> {
    tokio::time::timeout(
      Duration::from_secs(20),
      self.access.membership(guild, credential),
    )
    .await
    .map_err(ApiError::upstream)?
  }

  /// Caps the administrator and bot permission lookups needed for the channel picker.
  ///
  /// # Errors
  ///
  /// Returns credential or permission errors from [`GuildAccess::voice_channels`], or an
  /// upstream error when the 25-second lookup deadline expires.
  async fn channels(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Vec<VoiceChannel>, ApiError> {
    tokio::time::timeout(
      Duration::from_secs(25),
      self.access.voice_channels(guild, credential),
    )
    .await
    .map_err(ApiError::upstream)?
  }
}

/// Exchanges a code once; subsequent API calls carry the returned bearer token.
/// Proxy authentication and the API concurrency limit apply before contacting Discord.
///
/// # Errors
///
/// Returns an error for failed proxy authentication, invalid guild or code input, a full
/// request limit, a rejected exchange, or the 20-second exchange deadline. No token is persisted.
async fn authenticate<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<AccessToken>, ApiError> {
  let (_, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let Credential::Code(code) = credential else {
    return Err(ApiError::INVALID);
  };
  let token = tokio::time::timeout(Duration::from_secs(20), state.access.exchange_code(&code))
    .await
    .map_err(ApiError::upstream)??;
  Ok(Json(token))
}

/// Runs a synchronous redb operation off the async executor and maps failures for HTTP.
///
/// # Errors
///
/// Returns an internal API error when the blocking task fails or its database operation
/// returns an error. Transaction semantics belong to [`Store`].
async fn database<T: Send + 'static>(
  work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, ApiError> {
  tokio::task::spawn_blocking(work)
    .await
    .map_err(ApiError::internal)?
    .map_err(ApiError::internal)
}

#[cfg(test)]
mod tests;
