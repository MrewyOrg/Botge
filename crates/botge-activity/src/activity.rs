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
use serde::Deserialize;
use tokio::sync::{Notify, Semaphore};

use crate::proxy::ProxyAuthenticator;
use botge_app::Application;
use botge_domain::settings::discord_id;

pub(crate) use botge_app::access::{AccessToken, Credential, GuildAccess, GuildRole, VoiceChannel};

/// Shared dependencies and the request limit for a single Activity API instance.
///
/// Handlers validate the proxy and input, authorize through Discord, then use the blocking
/// database helper. A successful settings response confirms persistence, not voice completion.
struct Activity<A> {
  access: A,
  proxy: ProxyAuthenticator,
  application: Arc<Application>,
  voice_changed: Arc<Notify>,
  slots: Semaphore,
  now: fn() -> Result<u64, std::time::SystemTimeError>,
}

/// Client-safe application failures serialized by the Activity adapter.
#[derive(Debug)]
pub(crate) struct ApiError(StatusCode, &'static str);
impl From<botge_app::access::AccessError> for ApiError {
  fn from(error: botge_app::access::AccessError) -> Self {
    use botge_app::access::FailureKind;
    let status = match error.0 {
      FailureKind::Unauthenticated => StatusCode::UNAUTHORIZED,
      FailureKind::InvalidInput => StatusCode::BAD_REQUEST,
      FailureKind::PermissionDenied => StatusCode::FORBIDDEN,
      FailureKind::NotFound => StatusCode::NOT_FOUND,
      FailureKind::Conflict => StatusCode::CONFLICT,
      FailureKind::Upstream => StatusCode::BAD_GATEWAY,
      FailureKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    };
    Self(status, error.1)
  }
}
impl ApiError {
  const UNAUTHORIZED: Self = Self(
    StatusCode::UNAUTHORIZED,
    "Discord authorization expired. Try again.",
  );
  const INVALID: Self = Self(StatusCode::BAD_REQUEST, "Invalid Activity request.");
  const fn new(status: StatusCode, message: &'static str) -> Self {
    Self(status, message)
  }
  fn upstream(error: impl std::fmt::Display) -> Self {
    botge_app::access::AccessError::upstream(error).into()
  }
  fn internal(error: impl std::fmt::Display) -> Self {
    botge_app::access::AccessError::internal(error).into()
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
pub fn router<A: GuildAccess>(
  application: Arc<Application>,
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
      application,
      voice_changed,
      slots: Semaphore::new(8),
      now: unix_seconds,
    }))
}

/// Reads the wall clock used to reject expired Discord proxy signatures.
///
/// # Errors
///
/// Returns an error if the host clock precedes the Unix epoch. The Activity state stores
/// this function as a capability so tests can supply a fixed or failing clock.
fn unix_seconds() -> Result<u64, std::time::SystemTimeError> {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|value| value.as_secs())
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
    let now = (self.now)().map_err(ApiError::internal)?;
    if !self.proxy.verify(headers, now) {
      return Err(ApiError::new(
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
      ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "Botge is busy. Try again shortly.",
      )
    })?;
    Ok((guild, credential, permit))
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

#[cfg(test)]
mod tests;

#[cfg(test)]
use botge_storage::Store;

#[cfg(test)]
use botge_app::access::Membership;
