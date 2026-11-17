//! Isolated Discord REST routes and loopback-only OAuth redirects.
use axum::{
  Json, Router,
  routing::{get, post},
};
use botge_app::access::AccessError as ApiError;
use botge_test_support::user;
use reqwest::StatusCode;
use serde_json::{Value, json};
/// Redirects OAuth fixtures to a loopback port while preserving the fixed API paths.
///
/// # Errors
/// Returns an authentication failure for invalid or non-loopback origins.
pub fn redirect_oauth(
  mut request: reqwest::Request,
  origin: Option<&str>,
) -> Result<reqwest::Request, ApiError> {
  if let Some(origin) = origin {
    let origin = reqwest::Url::parse(origin).map_err(|_error| ApiError::UNAUTHORIZED)?;
    if origin.scheme() != "http" || origin.host_str() != Some("127.0.0.1") {
      return Err(ApiError::UNAUTHORIZED);
    }
    // Keep the fixed API path and query while sending them to the validated loopback origin.
    let mut redirected = origin;
    redirected.set_path(request.url().path());
    redirected.set_query(request.url().query());
    *request.url_mut() = redirected;
  }
  Ok(request)
}

pub(crate) fn guild() -> Value {
  json!({
      "id":"1","name":"Fixture","owner_id":"2","verification_level":0,
      "default_message_notifications":0,"explicit_content_filter":0,
      "roles":[{"id":"1","name":"everyone","color":0,"colors":{"primary_color":0},"hoist":false,"position":0,
          "permissions":"1049600","managed":false,"mentionable":false,"flags":0},
          {"id":"9","name":"Artists","color":0,"colors":{"primary_color":0},"hoist":false,"position":1,
          "permissions":"0","managed":false,"mentionable":false,"flags":0},
          {"id":"10","name":"Helpers","color":0,"colors":{"primary_color":0},"hoist":false,"position":1,
          "permissions":"0","managed":false,"mentionable":false,"flags":0},
          {"id":"11","name":"Integration","color":0,"colors":{"primary_color":0},"hoist":false,"position":2,
          "permissions":"0","managed":true,"mentionable":false,"flags":0}],
      "emojis":[],"features":[],"mfa_level":0,"system_channel_flags":0,
      "premium_tier":0,"preferred_locale":"en-US","nsfw_level":0,"stickers":[],
      "premium_progress_bar_enabled":false
  })
}

/// A gateway member record for guild 1 that joined with no roles.
#[must_use]
pub fn gateway_member(id: &str) -> Value {
  json!({
    "user":user(id),"roles":[],"joined_at":"2026-01-01T00:00:00Z",
    "deaf":false,"mute":false,"flags":0
  })
}

/// A full `GUILD_CREATE` payload for guild 1 with voice and text channels and `members`.
///
/// The gateway sends the guild object itself as the event payload.
#[must_use]
pub fn gateway_guild(owner: &str, members: &[&str]) -> Value {
  let mut fields = guild().as_object().cloned().unwrap_or_default();
  fields.insert("owner_id".into(), json!(owner));
  fields.insert("joined_at".into(), json!("2026-01-01T00:00:00Z"));
  fields.insert("large".into(), json!(false));
  fields.insert("member_count".into(), json!(3));
  fields.insert(
    "members".into(),
    members.iter().copied().map(gateway_member).collect(),
  );
  for empty in [
    "voice_states",
    "presences",
    "threads",
    "stage_instances",
    "guild_scheduled_events",
  ] {
    fields.insert(empty.into(), json!([]));
  }
  fields.insert(
    "channels".into(),
    json!([
      {"id":"42","guild_id":"1","name":"Second","type":2,"position":2},
      {"id":"43","guild_id":"1","name":"First","type":2,"position":1},
      {"id":"44","guild_id":"1","name":"Text","type":0,"position":0}
    ]),
  );
  Value::Object(fields)
}

/// Supplies OAuth and member responses for both access checks and bot startup tests.
/// The `owner` code resolves to the guild owner. Other valid codes resolve to a regular member.
pub fn fixture_routes() -> Router {
  Router::new()
    .route("/api/v10/applications/42/commands", get(||async { Json(Vec::<Value>::new()) }).post(|Json(body):Json<Value>|async move {
      Json(json!({"id":"7","application_id":"42","type":1,"name":body.get("name"),"description":"Fixture","version":"1"}))
    }))
    .route(
      "/api/v10/oauth2/token",
      post(|body: String| async move {
        if body.ends_with("code=invalid") {
          return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid_grant"})),
          );
        }
        if body.ends_with("code=misconfigured") {
          return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"invalid_client"})),
          );
        }
        if body.ends_with("code=unavailable") {
          return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({})));
        }
        let user = if body.ends_with("code=owner") {
          "2"
        } else {
          "3"
        };
        (
          StatusCode::OK,
          Json(json!({"access_token":user,"expires_in":3600})),
        )
      }),
    )
    .route(
      "/api/v10/users/@me",
      get(|headers: axum::http::HeaderMap| async move {
        let id = headers
          .get("authorization")
          .and_then(|header| header.to_str().ok())
          .and_then(|value| value.strip_prefix("Bearer "))
          .unwrap_or("42");
        Json(user(id))
      }),
    )
    .route(
      "/api/v10/guilds/1/members/{id}",
      get(
        |axum::extract::Path(id): axum::extract::Path<String>| async move {
          Json(json!({"user":user(&id),"roles":[],"deaf":false,"mute":false,"flags":0}))
        },
      ),
    )
}
