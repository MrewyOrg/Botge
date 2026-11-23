//! Exercises Discord identity, guild permissions, and channel filtering with local REST routes.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::assert_matches;

use axum::{
  Json, Router,
  response::IntoResponse as _,
  routing::{get, post},
};
use serde_json::json;

use super::*;
use crate::test_support::{fixture_routes, gateway_member, guild, redirect_oauth};
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
    empty_gateway(),
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
    assert_eq!(error.0, FailureKind::Upstream);
  }
  for token in ["bad-id", "bad-json", "unavailable", "invalid\nheader"] {
    assert_matches!(
      access.identify(&Credential::new(token.into())).await,
      Err(_)
    );
  }
  let credential = Credential::new("good".into());
  assert_matches!(
    access.membership(NonZeroU64::MIN, &credential).await,
    Err(_)
  );
  assert_matches!(
    access.voice_channels(NonZeroU64::MIN, &credential).await,
    Err(_)
  );
  drop(server);
  // A token not seen before needs Discord, so the closed transport surfaces.
  let error = access
    .identify(&Credential::new("unseen".into()))
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("closed transport accepted"))?;
  assert_eq!(error.0, FailureKind::Upstream);
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

/// A ready gateway over `cache`.
fn gateway(cache: &Arc<Cache>) -> Gateway {
  Gateway {
    cache: Arc::clone(cache),
    ready: watch::channel(true).1,
  }
}

/// A ready gateway with no guilds, for scenarios that never read one.
fn empty_gateway() -> Gateway {
  gateway(&Arc::new(Cache::new()))
}

/// A ready gateway holding guild 1, owned by user 2, whose members all come from REST.
fn loaded_gateway() -> anyhow::Result<Gateway> {
  let cache = Arc::new(Cache::new());
  cache.update(&mut gateway_guild("2", &[])?);
  Ok(gateway(&cache))
}

/// Reports whether the credential's holder administers the fixture guild.
async fn administrator(access: &DiscordAccess, credential: &Credential) -> anyhow::Result<bool> {
  access
    .membership(NonZeroU64::MIN, credential)
    .await
    .map(|member| member.administrator)
    .map_err(|_error| anyhow::anyhow!("membership failed"))
}

#[tokio::test]
#[expect(
  clippy::too_many_lines,
  reason = "Keep the sequential fixture setup, actions, and assertions in one scenario"
)]
async fn reuses_identity_and_rest_members_until_their_windows_end() -> anyhow::Result<()> {
  use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
  let exchanges = Arc::new(AtomicUsize::new(0));
  let identities = Arc::new(AtomicUsize::new(0));
  let revoked = Arc::new(AtomicBool::new(false));
  let departed = Arc::new(AtomicBool::new(false));
  let member_fetches = Arc::new(AtomicUsize::new(0));
  let routes = Router::new()
    .route(
      "/api/v10/guilds/1/members/{id}",
      get({
        let member_fetches = Arc::clone(&member_fetches);
        let departed = Arc::clone(&departed);
        move || {
          member_fetches.fetch_add(1, Ordering::Relaxed);
          let departed = departed.load(Ordering::Relaxed);
          async move {
            if departed {
              Err(StatusCode::NOT_FOUND)
            } else {
              Ok(Json(gateway_member("2")))
            }
          }
        }
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
    );
  let server = TestServer::start(routes).await?;
  let mut access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
    loaded_gateway()?,
  )?;
  let token = access
    .exchange_code("one-use")
    .await
    .map_err(|_error| anyhow::anyhow!("exchange failed"))?;
  let credential = Credential::new(token.access_token);
  // The exchange identifies the new token, so its first requests ask Discord nothing more.
  assert_eq!(identities.load(Ordering::Relaxed), 1);
  for _ in 0..3 {
    assert!(
      access
        .membership(NonZeroU64::MIN, &credential)
        .await
        .map_err(|_error| anyhow::anyhow!("membership failed"))?
        .administrator
    );
  }
  // That identity and one REST member lookup serve every request inside their windows.
  assert_eq!(identities.load(Ordering::Relaxed), 1);
  assert_eq!(member_fetches.load(Ordering::Relaxed), 1);
  departed.store(true, Ordering::Relaxed);
  assert!(
    administrator(&access, &credential).await?,
    "cached member within the window"
  );
  // Once the REST copy expires, the departure applies.
  access.set_member_ttl(Duration::ZERO);
  assert_matches!(
    access.membership(NonZeroU64::MIN, &credential).await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_eq!(member_fetches.load(Ordering::Relaxed), 2);
  revoked.store(true, Ordering::Relaxed);
  assert!(
    access.user_id(&credential).await.is_ok(),
    "cached identity within the window"
  );
  // Once the cached identity expires, Discord's revocation applies and is not cached.
  access.set_identity_ttl(Duration::ZERO);
  let error = access
    .user_id(&credential)
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("revoked token accepted"))?;
  assert_eq!(error.0, FailureKind::Unauthenticated);
  assert_matches!(access.user_id(&credential).await, Err(_));
  assert_eq!(exchanges.load(Ordering::Relaxed), 1);
  assert_eq!(identities.load(Ordering::Relaxed), 3);
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
    loaded_gateway()?,
  )?;
  // Fixture codes exchange for the owner's token and a regular member's token.
  for (code, owns) in [("owner", true), ("member", false)] {
    let token = access
      .exchange_code(code)
      .await
      .map_err(|_error| anyhow::anyhow!("exchange failed"))?;
    assert_eq!(
      administrator(&access, &Credential::new(token.access_token)).await?,
      owns
    );
  }
  let owner = access
    .membership(NonZeroU64::MIN, &Credential::new("2".into()))
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
    .user_id(&Credential::new("2".into()))
    .await
    .map_err(|_error| anyhow::anyhow!("identity lookup failed"))?;
  assert_eq!(identity.get(), 2);
  let member = access
    .membership(NonZeroU64::MIN, &Credential::new("3".into()))
    .await
    .map_err(|_error| anyhow::anyhow!("member lookup failed"))?;
  assert!(!member.administrator);
  let channels = access
    .voice_channels(NonZeroU64::MIN, &Credential::new("2".into()))
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
      .voice_channels(NonZeroU64::MIN, &Credential::new("3".into()))
      .await,
    Err(_)
  );
  assert_matches!(
    access
      .membership(NonZeroU64::MAX, &Credential::new("2".into()))
      .await,
    Err(_)
  );
  for (code, expected) in [
    ("invalid", StatusCode::UNAUTHORIZED),
    ("misconfigured", StatusCode::BAD_GATEWAY),
  ] {
    let error = access
      .exchange_code(code)
      .await
      .err()
      .ok_or_else(|| anyhow::anyhow!("OAuth unexpectedly succeeded"))?;
    assert_eq!(
      error.0,
      match expected {
        StatusCode::UNAUTHORIZED => FailureKind::Unauthenticated,
        StatusCode::FORBIDDEN => FailureKind::PermissionDenied,
        StatusCode::BAD_GATEWAY => FailureKind::Upstream,
        _ => anyhow::bail!("unexpected fixture status"),
      }
    );
  }
  assert_matches!(access.exchange_code("unavailable").await, Err(_));
  Ok(())
}

#[test]
fn diagnostics_keep_oauth_secrets_out_of_debug_output() -> anyhow::Result<()> {
  let oauth = OAuthClient {
    application_id: NonZeroU64::MIN,
    secret: "never-print-client-secret".into(),
  };
  assert!(!format!("{oauth:?}").contains("never-print"));
  let access = DiscordAccess::new(
    oauth,
    UserId::new(42),
    Arc::new(Http::new("fixture")),
    empty_gateway(),
  )?;
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
    empty_gateway(),
  )?;
  for code in ["invalid", "misconfigured"] {
    assert_matches!(access.exchange_code(code).await, Err(_));
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
    empty_gateway(),
  )?;
  let token = access.exchange_code("never-print-this-code").await?;
  assert_eq!(
    access
      .identify(&Credential::new(token.access_token))
      .await?,
    UserId::new(2)
  );
  let text = logs.text()?;
  assert!(text.contains("Discord rejected the Activity OAuth client"));
  assert!(text.contains("Discord rejected the Activity OAuth code"));
  assert!(!text.contains("never-print"));
  Ok(())
}

#[test]
fn shows_the_project_link_as_a_watching_status() {
  let presence = presence();
  assert_eq!(presence.kind, serenity::all::ActivityType::Watching);
  assert_eq!(presence.name, "github.com/MrewyOrg/Botge");
}

#[tokio::test]
async fn reuses_denials_briefly_and_pauses_oauth_after_a_rate_limit() -> anyhow::Result<()> {
  use std::sync::atomic::{AtomicUsize, Ordering};
  drop(
    tracing_subscriber::fmt()
      .with_max_level(tracing::Level::WARN)
      .with_test_writer()
      .try_init(),
  );
  let identities = Arc::new(AtomicUsize::new(0));
  let members = Arc::new(AtomicUsize::new(0));
  let routes = Router::new()
    .route(
      "/api/v10/users/@me",
      get({
        let identities = Arc::clone(&identities);
        move |headers: axum::http::HeaderMap| {
          identities.fetch_add(1, Ordering::Relaxed);
          async move {
            match headers
              .get("authorization")
              .and_then(|value| value.to_str().ok())
            {
              Some("Bearer revoked") => StatusCode::UNAUTHORIZED.into_response(),
              Some("Bearer limited") => (
                StatusCode::TOO_MANY_REQUESTS,
                [("retry-after", "30")],
                Json(json!({"message":"You are being rate limited.","retry_after":30})),
              )
                .into_response(),
              _ => Json(user("3")).into_response(),
            }
          }
        }
      }),
    )
    .route("/api/v10/guilds/{guild}", get(|| async { Json(guild()) }))
    .route(
      "/api/v10/guilds/1/members/{id}",
      get({
        let members = Arc::clone(&members);
        move || {
          members.fetch_add(1, Ordering::Relaxed);
          async {
            (
              StatusCode::NOT_FOUND,
              Json(json!({"code":10007,"message":"Unknown Member"})),
            )
          }
        }
      }),
    );
  let server = TestServer::start(routes).await?;
  let mut access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
    loaded_gateway()?,
  )?;

  // A rejected token and a non-member are answered locally while the denial is fresh.
  let revoked = Credential::new("revoked".into());
  let outsider = Credential::new("outsider".into());
  for _ in 0..3 {
    assert_matches!(
      access.user_id(&revoked).await,
      Err(ApiError(FailureKind::Unauthenticated, _))
    );
    assert_matches!(
      access.membership(NonZeroU64::MIN, &outsider).await,
      Err(ApiError(FailureKind::PermissionDenied, _))
    );
  }
  assert_eq!(identities.load(Ordering::Relaxed), 2);
  assert_eq!(members.load(Ordering::Relaxed), 1);
  // Denials expire with the record window they stand in for.
  access.set_member_ttl(Duration::ZERO);
  assert_matches!(
    access.membership(NonZeroU64::MIN, &outsider).await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_eq!(members.load(Ordering::Relaxed), 2);

  // One 429 pauses every OAuth call, so other tokens wait without contacting Discord.
  let before = identities.load(Ordering::Relaxed);
  assert_matches!(
    access.user_id(&Credential::new("limited".into())).await,
    Err(ApiError(FailureKind::RateLimited, _))
  );
  assert_matches!(
    access.user_id(&Credential::new("fresh".into())).await,
    Err(ApiError(FailureKind::RateLimited, _))
  );
  assert_matches!(
    access.exchange_code("code").await,
    Err(ApiError(FailureKind::RateLimited, _))
  );
  assert_eq!(identities.load(Ordering::Relaxed), before + 1);
  Ok(())
}

/// The shared `GUILD_CREATE` fixture as the event the gateway cache applies.
fn gateway_guild(owner: &str, members: &[&str]) -> anyhow::Result<serenity::all::GuildCreateEvent> {
  Ok(serde_json::from_value(crate::test_support::gateway_guild(
    owner, members,
  ))?)
}

/// Identity routes plus a member route that counts every read and denies it.
fn gateway_rest_routes(rest_reads: &Arc<std::sync::atomic::AtomicUsize>) -> Router {
  use std::sync::atomic::Ordering;
  let rest_reads = Arc::clone(rest_reads);
  Router::new()
    .route(
      "/api/v10/users/@me",
      get(|headers: axum::http::HeaderMap| async move {
        let id = headers
          .get("authorization")
          .and_then(|value| value.to_str().ok())
          .and_then(|value| value.strip_prefix("Bearer "))
          .unwrap_or("42")
          .to_owned();
        Json(user(&id))
      }),
    )
    .route(
      "/api/v10/guilds/1/members/{id}",
      get(move || {
        rest_reads.fetch_add(1, Ordering::Relaxed);
        async {
          (
            StatusCode::NOT_FOUND,
            Json(json!({"code":10007,"message":"Unknown Member"})),
          )
        }
      }),
    )
}

#[tokio::test]
async fn reads_guild_rules_and_channels_from_the_gateway_cache() -> anyhow::Result<()> {
  use std::sync::atomic::Ordering;
  let rest_reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
  let routes = gateway_rest_routes(&rest_reads);
  let server = TestServer::start(routes).await?;
  let cache = Arc::new(Cache::new());
  cache.update(&mut gateway_guild("2", &["2", "3", "42"])?);
  let access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
    gateway(&cache),
  )?;
  let owner = Credential::new("2".into());

  let membership = access
    .membership(NonZeroU64::MIN, &owner)
    .await
    .map_err(|_error| anyhow::anyhow!("membership failed"))?;
  assert!(membership.administrator);
  assert_eq!(
    membership
      .available_roles
      .iter()
      .map(|role| role.name.as_str())
      .collect::<Vec<_>>(),
    ["Artists", "Helpers"]
  );
  let channels = Box::pin(access.voice_channels(NonZeroU64::MIN, &owner))
    .await
    .map_err(|_error| anyhow::anyhow!("channel lookup failed"))?;
  assert_eq!(
    channels
      .iter()
      .map(|channel| channel.name.as_str())
      .collect::<Vec<_>>(),
    ["First", "Second"]
  );

  // A gateway ownership change applies on the next request, with no cache window to wait out.
  cache.update(&mut gateway_guild("3", &["2", "3", "42"])?);
  assert!(!administrator(&access, &owner).await?);
  assert_matches!(
    Box::pin(access.voice_channels(NonZeroU64::MIN, &owner)).await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_eq!(
    rest_reads.load(Ordering::Relaxed),
    0,
    "member data came from REST"
  );

  // Member role changes and departures also apply at once.
  let member = Credential::new("3".into());
  let mut update: serenity::all::GuildMemberUpdateEvent = serde_json::from_value(json!({
    "guild_id":"1","roles":["9"],"user":user("3"),"joined_at":"2026-01-01T00:00:00Z",
    "deaf":false,"mute":false,"pending":false,"flags":0
  }))?;
  cache.update(&mut update);
  let roles = access
    .membership(NonZeroU64::MIN, &member)
    .await
    .map_err(|_error| anyhow::anyhow!("membership failed"))?
    .roles;
  assert_eq!(roles, ["9"]);
  let mut removal: serenity::all::GuildMemberRemoveEvent =
    serde_json::from_value(json!({"guild_id":"1","user":user("3")}))?;
  cache.update(&mut removal);
  // The departed member is no longer cached, so REST is asked and denies them.
  assert_matches!(
    access.membership(NonZeroU64::MIN, &member).await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_eq!(rest_reads.load(Ordering::Relaxed), 1);
  Ok(())
}

#[tokio::test]
async fn lists_shared_servers_from_the_gateway_cache_and_skips_denied_ones() -> anyhow::Result<()> {
  use std::sync::atomic::Ordering;
  let rest_reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
  let server = TestServer::start(gateway_rest_routes(&rest_reads)).await?;
  let cache = Arc::new(Cache::new());
  let (ready, waiting) = watch::channel(false);
  let access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
    Gateway {
      cache: Arc::clone(&cache),
      ready: waiting,
    },
  )?;
  let list = async |token: &str| {
    access
      .guilds(&Credential::new(token.into()))
      .await
      .map(|guilds| {
        guilds
          .into_iter()
          .map(|guild| (guild.id, guild.administrator))
          .collect::<Vec<_>>()
      })
  };

  // Before the gateway is ready, the list would be incomplete, so Botge asks to retry.
  assert_matches!(list("2").await, Err(ApiError(FailureKind::Upstream, _)));
  ready.send_replace(true);
  cache.update(&mut gateway_guild("2", &["2", "3", "42"])?);
  assert_eq!(list("2").await.ok(), Some(vec![("1".into(), true)]));
  assert_eq!(list("3").await.ok(), Some(vec![("1".into(), false)]));
  assert_eq!(rest_reads.load(Ordering::Relaxed), 0);
  // A user the cache lacks is checked over REST; the denial leaves the server out.
  assert_eq!(list("5").await.ok(), Some(vec![]));
  assert_eq!(rest_reads.load(Ordering::Relaxed), 1);
  Ok(())
}

#[tokio::test]
async fn answers_starting_until_the_gateway_delivers_a_guild() -> anyhow::Result<()> {
  let server = TestServer::start(fixture_routes()).await?;
  let cache = Arc::new(Cache::new());
  let (ready, waiting) = watch::channel(false);
  let access = DiscordAccess::new(
    OAuthClient {
      application_id: NonZeroU64::MIN,
      secret: "fixture".into(),
    },
    UserId::new(42),
    Arc::new(http_for(&server)),
    Gateway {
      cache: Arc::clone(&cache),
      ready: waiting,
    },
  )?;
  let owner = Credential::new("2".into());
  let starting = "Botge is still connecting to Discord. Try again shortly.";
  // Before the gateway is ready, a missing guild may still be on its way.
  assert_matches!(
    access.membership(NonZeroU64::MIN, &owner).await,
    Err(ApiError(FailureKind::Upstream, message)) if message == starting
  );
  // Once ready, a guild the gateway never delivered is one Botge is not in.
  ready.send_replace(true);
  assert_matches!(
    access.membership(NonZeroU64::MIN, &owner).await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  cache.update(&mut gateway_guild("2", &[])?);
  assert!(administrator(&access, &owner).await?);
  Ok(())
}

#[test]
fn evicts_expired_entries_then_everything_when_full() {
  let cache = Expiring::new(2);
  let fresh = Duration::from_mins(1);
  cache.insert(1, "first", fresh);
  cache.insert(2, "second", fresh);
  // A full map first drops the entries that the incoming window has outlived.
  cache.insert(3, "third", Duration::ZERO);
  assert_eq!(cache.get(&1, |_| fresh), None);
  assert_eq!(cache.get(&3, |_| fresh), Some("third"));
  // When every entry is still fresh, a full map starts over.
  cache.insert(4, "fourth", fresh);
  cache.insert(5, "fifth", fresh);
  assert_eq!(cache.get(&3, |_| fresh), None);
  assert_eq!(cache.get(&4, |_| fresh), None);
  assert_eq!(cache.get(&5, |_| fresh), Some("fifth"));
}

#[tokio::test]
async fn keeps_upstream_member_failures_and_unidentified_exchanges_uncached() -> anyhow::Result<()>
{
  use std::sync::atomic::{AtomicUsize, Ordering};
  let member_fetches = Arc::new(AtomicUsize::new(0));
  let routes = Router::new()
    .route(
      "/api/v10/oauth2/token",
      post(|| async { Json(json!({"access_token":"unidentified","expires_in":3600})) }),
    )
    .route(
      "/api/v10/users/@me",
      get(|headers: axum::http::HeaderMap| async move {
        let token = headers
          .get("authorization")
          .and_then(|value| value.to_str().ok())
          .and_then(|value| value.strip_prefix("Bearer "))
          .unwrap_or_default()
          .to_owned();
        if token == "unidentified" {
          StatusCode::SERVICE_UNAVAILABLE.into_response()
        } else {
          Json(user(&token)).into_response()
        }
      }),
    )
    .route(
      "/api/v10/guilds/1/members/{id}",
      get({
        let member_fetches = Arc::clone(&member_fetches);
        move || {
          member_fetches.fetch_add(1, Ordering::Relaxed);
          async {
            (
              StatusCode::SERVICE_UNAVAILABLE,
              Json(json!({"code":0,"message":"unavailable"})),
            )
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
    loaded_gateway()?,
  )?;
  // Sign-in still succeeds when Discord cannot identify the new token yet.
  let token = access
    .exchange_code("code")
    .await
    .map_err(|_error| anyhow::anyhow!("exchange failed"))?;
  assert_eq!(token.access_token, "unidentified");
  // A member lookup that fails upstream is reported as such and asked again next time.
  let owner = Credential::new("2".into());
  for _ in 0..2 {
    assert_matches!(
      access.membership(NonZeroU64::MIN, &owner).await,
      Err(ApiError(FailureKind::Upstream, _))
    );
  }
  assert_eq!(member_fetches.load(Ordering::Relaxed), 2);
  Ok(())
}
