//! Exercises Discord identity, guild permissions, and channel filtering with local REST routes.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::assert_matches;

use axum::{
  Json, Router,
  routing::{get, post},
};
use serde_json::json;

use super::*;
use crate::test_support::{fixture_routes, guild, redirect_oauth};
use crate::tests::{TestServer, http_for, user};

#[tokio::test]
async fn distinguishes_client_rejection_and_sanitizes_transport_and_decode_failures()
-> anyhow::Result<()> {
  let server = TestServer::start(
    Router::new()
      .route(
        "/api/v10/oauth2/token",
        post(|body: String| async move {
          if body.ends_with("code=bad-client") {
            (
              StatusCode::BAD_REQUEST,
              Json(json!({"error":"invalid_client"})),
            )
          } else if body.ends_with("code=bad-json") {
            (StatusCode::OK, Json(json!({})))
          } else {
            (
              StatusCode::OK,
              Json(json!({"access_token":"good","expires_in":3600})),
            )
          }
        }),
      )
      .route(
        "/api/v10/users/@me",
        get(|headers: axum::http::HeaderMap| async move {
          match headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
          {
            Some("Bearer bad-id") => (StatusCode::OK, Json(json!({"id":"invalid"}))),
            Some("Bearer bad-json") => (StatusCode::OK, Json(json!({}))),
            Some("Bearer unavailable") => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({}))),
            _ => (StatusCode::OK, Json(user("2"))),
          }
        }),
      )
      .route(
        "/api/v10/guilds/1",
        get(|| async {
          (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"code":0,"message":"unavailable"})),
          )
        }),
      )
      .route(
        "/api/v10/guilds/1/members/2",
        get(|| async {
          Json(json!({"user":user("2"),"roles":[],"deaf":false,"mute":false,"flags":0}))
        }),
      ),
  )
  .await?;
  let access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
  )?;
  let token = GuildAccess::exchange_code(&access, "good")
    .await
    .map_err(|_error| anyhow::anyhow!("token exchange failed"))?;
  assert_eq!(token.access_token, "good");
  for code in ["bad-client", "bad-json"] {
    let error = access
      .exchange_code(code)
      .await
      .err()
      .ok_or_else(|| anyhow::anyhow!("bad OAuth response accepted"))?;
    assert_eq!(error.0, botge_app::access::FailureKind::Upstream);
  }
  for token in ["bad-id", "bad-json", "unavailable", "invalid\nheader"] {
    assert_matches!(
      access
        .identify(&Credential::AccessToken(token.into()))
        .await,
      Err(_)
    );
  }
  let credential = Credential::AccessToken("good".into());
  assert_matches!(
    access.membership(NonZeroU64::MIN, &credential).await,
    Err(_)
  );
  assert_matches!(
    access.voice_channels(NonZeroU64::MIN, &credential).await,
    Err(_)
  );
  drop(server);
  let error = access
    .identify(&credential)
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("closed transport accepted"))?;
  assert_eq!(error.0, botge_app::access::FailureKind::Upstream);
  Ok(())
}

#[tokio::test]
async fn waits_for_ready_after_the_gateway_reconnects() -> anyhow::Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  let commands = Commands::new(
    Arc::new(botge_app::Application::new(
      botge_domain::providers::Providers::default(),
      store,
      None,
    )?),
    None,
  );
  let (ready, receiver) = watch::channel(true);
  let events = Events {
    commands,
    register_commands: false,
    registration: tokio::sync::OnceCell::new(),
    ready,
    voice_changed: Arc::new(Notify::new()),
  };
  events.set_gateway_stage(serenity::gateway::ConnectionStage::Disconnected);
  assert!(!*receiver.borrow());
  events.set_gateway_stage(serenity::gateway::ConnectionStage::Connected);
  assert!(!*receiver.borrow());
  Ok(())
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
    assert_matches!(
      redirect_oauth(client.post(endpoint).build()?, Some(origin)),
      Err(_)
    );
  }
  let original = redirect_oauth(client.post(endpoint).build()?, None)
    .map_err(|_error| anyhow::anyhow!("original request rejected"))?;
  assert_eq!(original.url().as_str(), endpoint);
  let redirected = redirect_oauth(
    client.post(endpoint).build()?,
    Some("http://127.0.0.1:1234/ignored"),
  )
  .map_err(|_error| anyhow::anyhow!("loopback request rejected"))?;
  assert_eq!(
    redirected.url().as_str(),
    "http://127.0.0.1:1234/api/v10/oauth2/token"
  );
  assert_eq!(redirected.method(), reqwest::Method::POST);
  Ok(())
}

#[tokio::test]
#[expect(
  clippy::too_many_lines,
  reason = "Keep the sequential fixture setup, actions, and assertions in one scenario"
)]
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
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
  )?;
  let token = access
    .exchange_code("one-use")
    .await
    .map_err(|_error| anyhow::anyhow!("exchange failed"))?;
  let credential = Credential::AccessToken(token.access_token);
  for _ in 0..3 {
    assert!(
      access
        .membership(NonZeroU64::MIN, &credential)
        .await
        .map_err(|_error| anyhow::anyhow!("membership failed"))?
        .administrator
    );
  }
  owner.store(false, Ordering::Relaxed);
  assert!(
    !access
      .membership(NonZeroU64::MIN, &credential)
      .await
      .map_err(|_error| anyhow::anyhow!("membership failed"))?
      .administrator
  );
  revoked.store(true, Ordering::Relaxed);
  let error = access
    .user_id(&credential)
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("revoked token accepted"))?;
  assert_eq!(error.0, botge_app::access::FailureKind::Unauthenticated);
  assert_eq!(exchanges.load(Ordering::Relaxed), 1);
  assert_eq!(identities.load(Ordering::Relaxed), 5);
  Ok(())
}

#[tokio::test]
async fn authenticates_members_and_filters_the_channels_that_the_bot_can_join() -> anyhow::Result<()>
{
  drop(
    tracing_subscriber::fmt()
      .with_max_level(tracing::Level::WARN)
      .with_test_writer()
      .try_init(),
  );
  let server = TestServer::start(fixture_routes()).await?;
  let http = Arc::new(http_for(&server));
  let access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    http,
  )?;
  let owner = access
    .membership(NonZeroU64::MIN, &Credential::Code("owner".into()))
    .await
    .map_err(|_error| anyhow::anyhow!("owner lookup failed"))?;
  assert!(owner.administrator);
  assert_eq!(
    owner.available_roles.first().map(|role| role.name.as_str()),
    Some("Artists")
  );
  assert_eq!(
    owner
      .available_roles
      .iter()
      .map(|role| role.name.as_str())
      .collect::<Vec<_>>(),
    ["Artists", "Helpers"]
  );
  let identity = access
    .user_id(&Credential::Code("owner".into()))
    .await
    .map_err(|_error| anyhow::anyhow!("identity lookup failed"))?;
  assert_eq!(identity.get(), 2);
  let member = access
    .membership(NonZeroU64::MIN, &Credential::Code("member".into()))
    .await
    .map_err(|_error| anyhow::anyhow!("member lookup failed"))?;
  assert!(!member.administrator);
  let channels = access
    .voice_channels(NonZeroU64::MIN, &Credential::Code("owner".into()))
    .await
    .map_err(|_error| anyhow::anyhow!("channel lookup failed"))?;
  assert_eq!(
    channels
      .iter()
      .map(|channel| channel.name.as_str())
      .collect::<Vec<_>>(),
    vec!["First", "Second"]
  );
  assert_matches!(
    access
      .voice_channels(NonZeroU64::MIN, &Credential::Code("member".into()))
      .await,
    Err(_)
  );
  assert_matches!(
    access
      .membership(NonZeroU64::MAX, &Credential::Code("owner".into()))
      .await,
    Err(_)
  );
  for (code, expected) in [
    ("invalid", StatusCode::UNAUTHORIZED),
    ("misconfigured", StatusCode::BAD_GATEWAY),
  ] {
    let error = access
      .identify(&Credential::Code(code.into()))
      .await
      .err()
      .ok_or_else(|| anyhow::anyhow!("OAuth unexpectedly succeeded"))?;
    assert_eq!(
      error.0,
      match expected {
        StatusCode::UNAUTHORIZED => botge_app::access::FailureKind::Unauthenticated,
        StatusCode::FORBIDDEN => botge_app::access::FailureKind::PermissionDenied,
        StatusCode::BAD_GATEWAY => botge_app::access::FailureKind::Upstream,
        _ => anyhow::bail!("unexpected fixture status"),
      }
    );
  }
  assert_matches!(
    access
      .identify(&Credential::Code("unavailable".into()))
      .await,
    Err(_)
  );
  Ok(())
}

#[test]
fn diagnostics_keep_oauth_secrets_out_of_debug_output() -> anyhow::Result<()> {
  let oauth = OAuthClient {
    application_id: NonZeroU64::MIN,
    secret: "never-print-client-secret".into(),
  };
  assert!(!format!("{oauth:?}").contains("never-print"));
  let access = DiscordAccess::new(oauth, UserId::new(42), Arc::new(Http::new("fixture")))?;
  assert!(!format!("{access:?}").contains("never-print"));
  Ok(())
}

#[tokio::test]
async fn forwards_oauth_diagnostics_to_legacy_logging_without_secrets() -> anyhow::Result<()> {
  let Some(logs) = botge_test_support::legacy_logging_fixture(
    "discord::tests::forwards_oauth_diagnostics_to_legacy_logging_without_secrets",
  )?
  else {
    return Ok(());
  };
  let server = TestServer::start(fixture_routes()).await?;
  let access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "never-print-this-secret".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
  )?;
  for code in ["invalid", "misconfigured"] {
    assert_matches!(
      access.identify(&Credential::Code(code.into())).await,
      Err(_)
    );
    assert_matches!(
      access
        .membership(NonZeroU64::MIN, &Credential::Code(code.into()))
        .await,
      Err(_)
    );
    assert_matches!(
      access
        .voice_channels(NonZeroU64::MIN, &Credential::Code(code.into()))
        .await,
      Err(_)
    );
  }
  let server = TestServer::start(
    Router::new()
      .route(
        "/api/v10/oauth2/token",
        post(|body: String| async move {
          assert!(body.contains("client_secret=never-print-this-secret"));
          assert!(body.contains("code=never-print-this-code"));
          Json(json!({"access_token":"never-print-this-token","expires_in":3600}))
        }),
      )
      .route(
        "/api/v10/users/@me",
        get(|headers: axum::http::HeaderMap| async move {
          assert_eq!(
            headers
              .get("authorization")
              .and_then(|value| value.to_str().ok()),
            Some("Bearer never-print-this-token")
          );
          Json(user("2"))
        }),
      ),
  )
  .await?;
  let access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "never-print-this-secret".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
  )?;
  assert_eq!(
    access
      .identify(&Credential::Code("never-print-this-code".into()))
      .await?,
    UserId::new(2)
  );
  let text = logs.text()?;
  assert!(text.contains("Discord rejected the Activity OAuth client"));
  assert!(text.contains("Discord rejected the Activity OAuth code"));
  assert!(!text.contains("never-print"));
  Ok(())
}
