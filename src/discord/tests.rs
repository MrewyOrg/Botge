//! Exercises Discord identity, guild permissions, and channel filtering with local REST routes.

use axum::{
  Json, Router,
  http::StatusCode,
  routing::{get, post},
};
use serde_json::{Value, json};

use super::*;
use crate::tests::{TestServer, http_for, user};

/// Redirects OAuth fixtures to a loopback port while preserving the fixed API paths.
pub(super) fn redirect_oauth(
  mut request: reqwest::Request,
  origin: Option<&str>,
) -> Result<reqwest::Request, ApiError> {
  if let Some(origin) = origin {
    let origin = reqwest::Url::parse(origin).map_err(|_| ApiError::UNAUTHORIZED)?;
    if origin.scheme() != "http" || origin.host_str() != Some("127.0.0.1") {
      return Err(ApiError::UNAUTHORIZED);
    }
    let url = request.url_mut();
    url
      .set_scheme("http")
      .map_err(|()| ApiError::UNAUTHORIZED)?;
    url
      .set_host(Some("127.0.0.1"))
      .map_err(|_| ApiError::UNAUTHORIZED)?;
    url
      .set_port(origin.port())
      .map_err(|()| ApiError::UNAUTHORIZED)?;
  }
  Ok(request)
}

#[test]
fn oauth_fixtures_preserve_paths_and_reject_non_loopback_destinations() -> anyhow::Result<()> {
  let client = reqwest::Client::new();
  let endpoint = "https://discord.com/api/v10/oauth2/token";
  for origin in [
    "invalid",
    "https://127.0.0.1:1234",
    "http://example.com:1234",
  ] {
    assert!(redirect_oauth(client.post(endpoint).build()?, Some(origin)).is_err());
  }
  let original = redirect_oauth(client.post(endpoint).build()?, None)
    .map_err(|_| anyhow::anyhow!("original request rejected"))?;
  assert_eq!(original.url().as_str(), endpoint);
  let redirected = redirect_oauth(
    client.post(endpoint).build()?,
    Some("http://127.0.0.1:1234/ignored"),
  )
  .map_err(|_| anyhow::anyhow!("loopback request rejected"))?;
  assert_eq!(
    redirected.url().as_str(),
    "http://127.0.0.1:1234/api/v10/oauth2/token"
  );
  assert_eq!(redirected.method(), reqwest::Method::POST);
  Ok(())
}

fn guild() -> Value {
  json!({
      "id":"1","name":"Fixture","owner_id":"2","verification_level":0,
      "default_message_notifications":0,"explicit_content_filter":0,
      "roles":[{"id":"1","name":"everyone","color":0,"colors":{"primary_color":0},"hoist":false,"position":0,
          "permissions":"1049600","managed":false,"mentionable":false,"flags":0},
          {"id":"9","name":"Artists","color":0,"colors":{"primary_color":0},"hoist":false,"position":1,
          "permissions":"0","managed":false,"mentionable":false,"flags":0}],
      "emojis":[],"features":[],"mfa_level":0,"system_channel_flags":0,
      "premium_tier":0,"preferred_locale":"en-US","nsfw_level":0,"stickers":[],
      "premium_progress_bar_enabled":false
  })
}

#[tokio::test]
async fn reuses_one_code_exchange_and_rechecks_identity_and_permissions() -> anyhow::Result<()> {
  use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
  let exchanges = Arc::new(AtomicUsize::new(0));
  let identities = Arc::new(AtomicUsize::new(0));
  let revoked = Arc::new(AtomicBool::new(false));
  let owner = Arc::new(AtomicBool::new(true));
  let routes = Router::new()
    .route(
      "/api/v10/guilds/1/members/{id}",
      get(|| async {
        Json(json!({"user":user("2"),"roles":[],"deaf":false,"mute":false,"flags":0}))
      }),
    )
    .route(
      "/api/v10/oauth2/token",
      post({
        let exchanges = Arc::clone(&exchanges);
        move || {
          let exchanges = Arc::clone(&exchanges);
          async move {
            if exchanges.fetch_add(1, Ordering::Relaxed) == 0 {
              (
                StatusCode::OK,
                Json(json!({"access_token":"session", "expires_in":3600})),
              )
            } else {
              (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"invalid_grant"})),
              )
            }
          }
        }
      }),
    )
    .route(
      "/api/v10/users/@me",
      get({
        let identities = Arc::clone(&identities);
        let revoked = Arc::clone(&revoked);
        move || {
          let identities = Arc::clone(&identities);
          let revoked = Arc::clone(&revoked);
          async move {
            identities.fetch_add(1, Ordering::Relaxed);
            if revoked.load(Ordering::Relaxed) {
              Err(StatusCode::UNAUTHORIZED)
            } else {
              Ok(Json(user("2")))
            }
          }
        }
      }),
    )
    .route(
      "/api/v10/guilds/{guild}",
      get({
        let owner = Arc::clone(&owner);
        move || {
          let owner = Arc::clone(&owner);
          async move {
            let mut value = guild();
            if !owner.load(Ordering::Relaxed)
              && let Some(id) = value.get_mut("owner_id")
            {
              *id = json!("3");
            }
            Json(value)
          }
        }
      }),
    );
  let server = TestServer::start(routes).await?;
  let access = DiscordAccess::new(
    NonZeroU64::MIN,
    "fixture".into(),
    UserId::new(42),
    Arc::new(http_for(&server)),
  )?;
  let token = access
    .exchange_code("one-use")
    .await
    .map_err(|_| anyhow::anyhow!("exchange failed"))?;
  let credential = Credential::AccessToken(token.access_token);
  for _ in 0..3 {
    assert!(
      access
        .membership(NonZeroU64::MIN, &credential)
        .await
        .map_err(|_| anyhow::anyhow!("membership failed"))?
        .administrator
    );
  }
  owner.store(false, Ordering::Relaxed);
  assert!(
    !access
      .membership(NonZeroU64::MIN, &credential)
      .await
      .map_err(|_| anyhow::anyhow!("membership failed"))?
      .administrator
  );
  revoked.store(true, Ordering::Relaxed);
  let error = access
    .user_id(&credential)
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("revoked token accepted"))?;
  use axum::response::IntoResponse as _;
  assert_eq!(error.into_response().status(), StatusCode::UNAUTHORIZED);
  assert_eq!(exchanges.load(Ordering::Relaxed), 1);
  assert_eq!(identities.load(Ordering::Relaxed), 5);
  Ok(())
}

/// Supplies OAuth and guild responses for both access checks and bot startup tests.
/// The `owner` code resolves to the guild owner. Other valid codes resolve to a regular member.
pub(crate) fn fixture_routes() -> Router {
  Router::new()
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
      "/api/v10/guilds/{guild}",
      get(
        |axum::extract::Path(id): axum::extract::Path<String>| async move {
          if id == "1" {
            Ok(Json(guild()))
          } else {
            Err(StatusCode::NOT_FOUND)
          }
        },
      ),
    )
    .route(
      "/api/v10/guilds/1/members/{id}",
      get(
        |axum::extract::Path(id): axum::extract::Path<String>| async move {
          Json(json!({"user":user(&id),"roles":[],"deaf":false,"mute":false,"flags":0}))
        },
      ),
    )
    .route(
      "/api/v10/guilds/1/channels",
      get(|| async {
        Json(json!([
            {"id":"42","name":"Second","type":2,"position":2},
            {"id":"43","name":"First","type":2,"position":1},
            {"id":"44","name":"Text","type":0}
        ]))
      }),
    )
}

#[tokio::test]
async fn authenticates_members_and_filters_the_channels_that_the_bot_can_join() -> anyhow::Result<()>
{
  let _ = tracing_subscriber::fmt()
    .with_max_level(tracing::Level::WARN)
    .with_test_writer()
    .try_init();
  let server = TestServer::start(fixture_routes()).await?;
  let http = Arc::new(http_for(&server));
  let access = DiscordAccess::new(NonZeroU64::MIN, "fixture".into(), UserId::new(42), http)?;
  let owner = access
    .membership(NonZeroU64::MIN, &Credential::Code("owner".into()))
    .await
    .map_err(|_| anyhow::anyhow!("owner lookup failed"))?;
  assert!(owner.administrator);
  assert_eq!(
    owner.available_roles.first().map(|role| role.name.as_str()),
    Some("Artists")
  );
  let identity = access
    .user_id(&Credential::Code("owner".into()))
    .await
    .map_err(|_| anyhow::anyhow!("identity lookup failed"))?;
  assert_eq!(identity.get(), 2);
  let member = access
    .membership(NonZeroU64::MIN, &Credential::Code("member".into()))
    .await
    .map_err(|_| anyhow::anyhow!("member lookup failed"))?;
  assert!(!member.administrator);
  let channels = access
    .voice_channels(NonZeroU64::MIN, &Credential::Code("owner".into()))
    .await
    .map_err(|_| anyhow::anyhow!("channel lookup failed"))?;
  assert_eq!(
    channels
      .iter()
      .map(|channel| channel.name.as_str())
      .collect::<Vec<_>>(),
    vec!["First", "Second"]
  );
  assert!(
    access
      .voice_channels(NonZeroU64::MIN, &Credential::Code("member".into()))
      .await
      .is_err()
  );
  assert!(
    access
      .membership(NonZeroU64::MAX, &Credential::Code("owner".into()))
      .await
      .is_err()
  );
  use axum::response::IntoResponse as _;
  for (code, expected) in [
    ("invalid", StatusCode::UNAUTHORIZED),
    ("misconfigured", StatusCode::BAD_GATEWAY),
  ] {
    let error = access
      .identify(&Credential::Code(code.into()))
      .await
      .err()
      .ok_or_else(|| anyhow::anyhow!("OAuth unexpectedly succeeded"))?;
    assert_eq!(error.into_response().status(), expected);
  }
  assert!(
    access
      .identify(&Credential::Code("unavailable".into()))
      .await
      .is_err()
  );
  Ok(())
}
