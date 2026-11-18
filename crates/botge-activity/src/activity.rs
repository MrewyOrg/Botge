//! Activity HTTP handlers for Discord-authenticated settings and catalog operations.
//!
//! Requests carry Discord proxy signature headers and an OAuth bearer token. Only the auth route
//! accepts a one-use code, which it exchanges for that token. The signature authenticates the
//! proxy request. Discord identifies
//! the token holder, whose guild membership and permissions are checked separately for operations
//! scoped to a guild. Border preferences belong to the authenticated user across guilds.
//! The health route only reports HTTP readiness.
//!
//! Shared authentication and request limits live here. [`voice`], [`catalog`], and [`border`]
//! own their route payloads, authorization steps, and persistence operations. [`game`] owns the
//! guessing game's ticket, connection, and round image routes. [`watch`] owns the connection that
//! tells an open catalog when to reload.

mod border;
mod catalog;
mod game;
mod socket;
mod voice;
mod watch;

use std::{
  collections::HashMap,
  hash::{BuildHasher as _, RandomState},
  num::NonZeroU64,
  sync::{Arc, Mutex, PoisonError},
  time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
  Json, Router,
  extract::{DefaultBodyLimit, MatchedPath, Request, State},
  http::{HeaderMap, StatusCode, header},
  middleware::Next,
  response::{IntoResponse, Response},
  routing::{get, post},
};
use serde::Deserialize;
use tokio::sync::{Notify, Semaphore, SemaphorePermit};
use tower_http::compression::{
  CompressionLayer,
  predicate::{DefaultPredicate, Predicate as _, SizeAbove},
};

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
  /// Game and catalog watch connections open at once.
  sockets: Arc<Semaphore>,
  sessions: Sessions,
  now: fn() -> Result<u64, std::time::SystemTimeError>,
}

/// Requests one credential may have in flight; the rest of the shared slots stay available.
///
/// The Activity sends one request at a time. The second slot covers a request the browser
/// abandoned after its timeout while the server is still finishing it.
const SESSION_SLOTS: usize = 2;

/// Game and catalog watch connections the API keeps open at once; further upgrades answer 503.
const GAME_SOCKETS: usize = 256;

/// In-flight request counts keyed by a keyed hash of each credential.
///
/// Only the hash is kept, and only while that credential has a request in flight.
#[derive(Debug, Default)]
struct Sessions {
  hasher: RandomState,
  active: Mutex<HashMap<u64, usize>>,
}

impl Sessions {
  /// Reserves one of the credential's slots, or returns `None` when all are in use.
  fn admit(&self, credential: &str) -> Option<SessionSlot<'_>> {
    let key = self.hasher.hash_one(credential);
    let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
    let count = active.entry(key).or_default();
    if *count >= SESSION_SLOTS {
      return None;
    }
    *count += 1;
    drop(active);
    Some(SessionSlot {
      sessions: self,
      key,
    })
  }
}

/// Releases a credential's slot when the request finishes, including on cancellation.
#[derive(Debug)]
struct SessionSlot<'a> {
  sessions: &'a Sessions,
  key: u64,
}

impl Drop for SessionSlot<'_> {
  fn drop(&mut self) {
    let mut active = self
      .sessions
      .active
      .lock()
      .unwrap_or_else(PoisonError::into_inner);
    // The slot's own entry exists for as long as the slot does.
    let remaining = active.get_mut(&self.key).map(|count| {
      *count -= 1;
      *count
    });
    if remaining == Some(0) {
      active.remove(&self.key);
    }
  }
}

/// Keeps both the credential's slot and a shared slot for the rest of a handler.
#[derive(Debug)]
pub(crate) struct Admission<'a> {
  _session: SessionSlot<'a>,
  _shared: SemaphorePermit<'a>,
}

/// Client-safe application failures serialized by the Activity adapter.
///
/// The flag marks an expired or rejected OAuth credential. The Activity renews authorization
/// and retries once only for that case, never for a failed proxy signature.
#[derive(Debug)]
pub(crate) struct ApiError(StatusCode, &'static str, bool);
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
      FailureKind::RateLimited => StatusCode::TOO_MANY_REQUESTS,
      FailureKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    };
    Self(status, error.1, error.0 == FailureKind::Unauthenticated)
  }
}
impl ApiError {
  const INVALID: Self = Self(StatusCode::BAD_REQUEST, "Invalid Activity request.", false);
  const fn new(status: StatusCode, message: &'static str) -> Self {
    Self(status, message, false)
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
    let body = if self.2 {
      serde_json::json!({ "message": self.1, "code": "oauth_expired" })
    } else {
      serde_json::json!({ "message": self.1 })
    };
    (self.0, Json(body)).into_response()
  }
}

/// Guild context for a read; the caller is identified by the bearer header.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadSettings {
  guild_id: String,
}

/// A one-use authorization code to exchange for the bearer token used by every other route.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Authorize {
  guild_id: String,
  code: String,
}

/// Builds the Activity router with shared storage, emote resolution, and Discord access.
///
/// The Activity posts JSON even for reads. These responses carry
/// `Cache-Control: no-store` because permissions and preferences depend on the current caller.
/// The body limit and the per-handler concurrency limit bound separate parts of request work.
/// Responses from matched routes are counted by route and status in the application metrics.
/// Bodies over 1 KiB, such as large catalogs, are gzip-compressed for clients that accept it.
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
    .route("/catalog/watch", post(watch::watch::<A>))
    .route("/catalog/ws", get(watch::connect::<A>))
    .route("/game/join", post(game::join::<A>))
    .route("/game/ws", get(game::connect::<A>))
    .route("/game/image/{token}", get(game::image::<A>))
    .route_layer(axum::middleware::from_fn({
      let application = Arc::clone(&application);
      move |request: Request, next: Next| {
        let application = Arc::clone(&application);
        async move {
          let route = request
            .extensions()
            .get::<MatchedPath>()
            .map_or("unmatched", MatchedPath::as_str)
            .to_owned();
          let response = next.run(request).await;
          let status = response.status().as_u16();
          application.metrics().activity_request(&route, status);
          response
        }
      }
    }))
    .layer(DefaultBodyLimit::max(4096))
    .layer(CompressionLayer::new().compress_when(DefaultPredicate::new().and(SizeAbove::new(1024))))
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
      sockets: Arc::new(Semaphore::new(GAME_SOCKETS)),
      sessions: Sessions::default(),
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
  /// Checks the Discord proxy signature and its time window.
  ///
  /// # Errors
  ///
  /// Returns 401 for a missing, invalid, or expired signature, and 500 if the host clock
  /// cannot be read.
  fn verify_proxy(&self, headers: &HeaderMap) -> Result<(), ApiError> {
    let now = (self.now)().map_err(ApiError::internal)?;
    if self.proxy.verify(headers, now) {
      Ok(())
    } else {
      Err(ApiError::new(
        StatusCode::UNAUTHORIZED,
        "Discord Activity proxy authentication failed.",
      ))
    }
  }

  /// Checks the proxy signature and request shape before reserving concurrency slots.
  ///
  /// Keep the returned admission alive for the rest of the handler. It holds one of the
  /// credential's two slots and one of the eight shared slots while the handler contacts
  /// Discord, looks up emotes, or reads and writes preferences.
  ///
  /// # Errors
  ///
  /// An invalid signature yields 401. A malformed guild ID or credential yields 400. A
  /// credential that already has two requests in flight yields 429, and a full shared limit
  /// yields 503. Both answer immediately, so a burst of requests cannot queue inside the API.
  fn validate(
    &self,
    headers: &HeaderMap,
    guild: &str,
  ) -> Result<(NonZeroU64, Credential, Admission<'_>), ApiError> {
    self.verify_proxy(headers)?;
    let guild = discord_id(guild).ok_or(ApiError::INVALID)?;
    let token = headers
      .get(header::AUTHORIZATION)
      .and_then(|value| value.to_str().ok())
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
    let admission = self.admit(token)?;
    Ok((guild, Credential::new(token.to_owned()), admission))
  }

  /// Reserves one of the secret's request slots and one shared slot.
  ///
  /// # Errors
  ///
  /// Yields 429 when the secret already has two requests in flight and 503 when the shared
  /// limit is full.
  fn admit(&self, secret: &str) -> Result<Admission<'_>, ApiError> {
    let session = self.sessions.admit(secret).ok_or(ApiError::new(
      StatusCode::TOO_MANY_REQUESTS,
      "Too many requests at once. Try again shortly.",
    ))?;
    let shared = self.slots.try_acquire().map_err(|_error| {
      ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "Botge is busy. Try again shortly.",
      )
    })?;
    Ok(Admission {
      _session: session,
      _shared: shared,
    })
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
  Json(request): Json<Authorize>,
) -> Result<Json<AccessToken>, ApiError> {
  state.verify_proxy(&headers)?;
  discord_id(&request.guild_id).ok_or(ApiError::INVALID)?;
  let code = request.code;
  if code.is_empty()
    || code.len() > 512
    || !code
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
  {
    return Err(ApiError::INVALID);
  }
  let _permit = state.admit(&code)?;
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
