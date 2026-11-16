//! Sends signed requests directly through the Axum router with temporary storage and fake OAuth.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::{
  assert_matches,
  sync::atomic::{AtomicUsize, Ordering},
};

use anyhow::Context as _;
use axum::{
  body::{Body, to_bytes},
  http::{Method, Request},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use botge_domain::settings::VoiceSettings;
use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{Value, json};
use tower::ServiceExt as _;

use super::*;

/// Maps test authorization codes to fixed identities and guild permissions.
///
/// `admin` can change settings, `manager` carries role 42, and `member` has no elevated role.
/// The counter measures guild authorization independently of provider lookups.
pub(super) struct TestAccess(Arc<AtomicUsize>);

/// In this fixture, codes and tokens encode the same fixed test identity.
fn fixture_identity(credential: &Credential) -> &str {
  match credential {
    Credential::Code(value) | Credential::AccessToken(value) => value,
  }
}

#[expect(
  clippy::unused_async_trait_impl,
  reason = "Fixture counters and identity checks run when the returned future is polled"
)]
impl GuildAccess for TestAccess {
  async fn exchange_code(&self, code: &str) -> Result<AccessToken, botge_app::access::AccessError> {
    self.user_id(&Credential::Code(code.into())).await?;
    Ok(AccessToken {
      access_token: code.into(),
      expires_in: 3600,
    })
  }

  async fn user_id(
    &self,
    credential: &Credential,
  ) -> Result<NonZeroU64, botge_app::access::AccessError> {
    let code = fixture_identity(credential);
    match code {
      "admin" => Ok(NonZeroU64::MIN),
      "member" => Ok(NonZeroU64::MAX),
      _ => Err(botge_app::access::AccessError::UNAUTHORIZED),
    }
  }

  async fn membership(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Membership, botge_app::access::AccessError> {
    let code = fixture_identity(credential);
    self.0.fetch_add(1, Ordering::Relaxed);
    match code {
      "admin" | "manager" | "member" => Ok(Membership {
        administrator: code == "admin",
        roles: if code == "manager" {
          vec!["42".into()]
        } else {
          vec![]
        },
        available_roles: vec![GuildRole {
          id: "42".into(),
          name: "Emote manager".into(),
        }],
      }),
      _ => Err(botge_app::access::AccessError::UNAUTHORIZED),
    }
  }
  async fn voice_channels(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Vec<VoiceChannel>, botge_app::access::AccessError> {
    self.0.fetch_add(1, Ordering::Relaxed);
    let code = fixture_identity(credential);
    match code {
      "admin" => Ok(vec![VoiceChannel {
        id: "42".into(),
        name: "Voice".into(),
      }]),
      "member" => Err(botge_app::access::AccessError::FORBIDDEN),
      _ => Err(botge_app::access::AccessError::UNAUTHORIZED),
    }
  }
}

/// Owns the router, signing key, and temporary database for a single test.
pub(super) struct Fixture {
  _directory: tempfile::TempDir,
  pub(super) store: Arc<Store>,
  pub(super) changed: Arc<Notify>,
  pub(super) membership_calls: Arc<AtomicUsize>,
  pub(super) application: Arc<Application>,
  router: Router,
  key: SigningKey,
}

impl Fixture {
  /// Builds the same shared services for deterministic checks below the HTTP adapter.
  pub(super) fn state(&self) -> anyhow::Result<Activity<TestAccess>> {
    Ok(Activity {
      access: TestAccess(Arc::clone(&self.membership_calls)),
      proxy: ProxyAuthenticator::new(&hex::encode(self.key.verifying_key().as_bytes()))?,
      application: Arc::new(Application::new(
        botge_domain::providers::Providers::default(),
        Arc::clone(&self.store),
        None,
      )?),
      voice_changed: Arc::clone(&self.changed),
      slots: Semaphore::new(8),
      sockets: Arc::new(Semaphore::new(GAME_SOCKETS)),
      sessions: Sessions::default(),
      now: unix_seconds,
    })
  }

  pub(super) fn new() -> anyhow::Result<Self> {
    Self::with_emotes(None)
  }

  /// Enables individual 7TV additions only when the caller supplies a local provider origin.
  pub(super) fn with_emotes(origin: Option<reqwest::Url>) -> anyhow::Result<Self> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(&directory.path().join("botge.redb"))?);
    let changed = Arc::new(Notify::new());
    let key = SigningKey::from_bytes(&[17; 32]);
    let proxy = ProxyAuthenticator::new(&hex::encode(key.verifying_key().as_bytes()))?;
    let mut application = Application::new(
      botge_domain::providers::Providers {
        seven_added: origin.is_some(),
        ..Default::default()
      },
      Arc::clone(&store),
      None,
    )?;
    if let Some(origin) = origin {
      application.use_provider_fixture(origin);
    }
    let application = Arc::new(application);
    let membership_calls = Arc::new(AtomicUsize::new(0));
    let router = router(
      Arc::clone(&application),
      Arc::clone(&changed),
      proxy,
      TestAccess(Arc::clone(&membership_calls)),
    );
    Ok(Self {
      _directory: directory,
      store,
      changed,
      membership_calls,
      application,
      router,
      key,
    })
  }

  /// Posts JSON with optional proxy headers and checks the response's cache policy.
  pub(super) async fn post(
    &self,
    path: &str,
    body: &Value,
    signed: bool,
  ) -> anyhow::Result<(StatusCode, Value)> {
    self.post_with_token(path, body, signed, None).await
  }

  pub(super) async fn post_with_token(
    &self,
    path: &str,
    body: &Value,
    signed: bool,
    token: Option<&str>,
  ) -> anyhow::Result<(StatusCode, Value)> {
    let mut request = Request::builder()
      .method(Method::POST)
      .uri(path)
      .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = token {
      request = request.header(header::AUTHORIZATION, token);
    }
    if signed {
      let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
      let payload = json!({ "created_at": now, "expires_at": now + 60 }).to_string();
      let signature = self.key.sign(payload.as_bytes());
      request = request
        .header("x-discord-proxy-payload", STANDARD.encode(payload))
        .header("x-signature-ed25519", STANDARD.encode(signature.to_bytes()))
        .header("x-signature-timestamp", now);
    }
    let response = self
      .router
      .clone()
      .oneshot(request.body(Body::from(body.to_string()))?)
      .await?;
    assert_eq!(
      response.headers().get(header::CACHE_CONTROL),
      Some(&header::HeaderValue::from_static("no-store"))
    );
    let status = response.status();
    let body = to_bytes(response.into_body(), 8192).await?;
    Ok((status, serde_json::from_slice(&body)?))
  }
}

impl Fixture {
  /// The router, for scenarios that serve it over a loopback listener.
  pub(super) fn router(&self) -> Router {
    self.router.clone()
  }

  /// Proxy signature headers that are valid for the next minute.
  pub(super) fn signature(&self) -> anyhow::Result<[(&'static str, String); 3]> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let payload = json!({ "created_at": now, "expires_at": now + 60 }).to_string();
    let signature = self.key.sign(payload.as_bytes());
    Ok([
      ("x-discord-proxy-payload", STANDARD.encode(payload)),
      ("x-signature-ed25519", STANDARD.encode(signature.to_bytes())),
      ("x-signature-timestamp", now.to_string()),
    ])
  }

  /// Sends a GET with optional proxy headers and returns the status, content type and body.
  pub(super) async fn get(
    &self,
    path: &str,
    signed: bool,
  ) -> anyhow::Result<(StatusCode, Option<String>, Vec<u8>)> {
    let mut request = Request::builder().method(Method::GET).uri(path);
    if signed {
      for (name, value) in self.signature()? {
        request = request.header(name, value);
      }
    }
    let response = self
      .router
      .clone()
      .oneshot(request.body(Body::empty())?)
      .await?;
    let status = response.status();
    let kind = response
      .headers()
      .get(header::CONTENT_TYPE)
      .and_then(|value| value.to_str().ok())
      .map(str::to_owned);
    Ok((
      status,
      kind,
      to_bytes(response.into_body(), 8192).await?.into(),
    ))
  }
}

impl Fixture {
  /// Posts signed JSON with or without `Accept-Encoding: gzip`, returning the response encoding.
  pub(super) async fn content_encoding(
    &self,
    path: &str,
    body: &Value,
    accept_gzip: bool,
  ) -> anyhow::Result<Option<String>> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let payload = json!({ "created_at": now, "expires_at": now + 60 }).to_string();
    let signature = self.key.sign(payload.as_bytes());
    let mut request = Request::builder()
      .method(Method::POST)
      .uri(path)
      .header(header::CONTENT_TYPE, "application/json")
      .header("x-discord-proxy-payload", STANDARD.encode(payload))
      .header("x-signature-ed25519", STANDARD.encode(signature.to_bytes()))
      .header("x-signature-timestamp", now);
    if accept_gzip {
      request = request.header(header::ACCEPT_ENCODING, "gzip");
    }
    let response = self
      .router
      .clone()
      .oneshot(request.body(Body::from(body.to_string()))?)
      .await?;
    assert_eq!(response.status(), StatusCode::OK);
    Ok(
      response
        .headers()
        .get(header::CONTENT_ENCODING)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned),
    )
  }
}

fn validation_headers(key: &SigningKey) -> anyhow::Result<HeaderMap> {
  let payload = json!({"created_at":100,"expires_at":160}).to_string();
  let signature = key.sign(payload.as_bytes());
  Ok(
    Request::builder()
      .header("x-discord-proxy-payload", STANDARD.encode(payload))
      .header("x-signature-ed25519", STANDARD.encode(signature.to_bytes()))
      .header("x-signature-timestamp", 100)
      .body(())?
      .into_parts()
      .0
      .headers,
  )
}

#[test]
fn bounds_production_authentication_and_command_future_sizes() -> anyhow::Result<()> {
  crate::initialize_tls();
  let fixture = Fixture::new()?;
  let base = fixture.state()?;
  let http = Arc::new(serenity::http::Http::new("fixture"));
  let state = Arc::new(Activity {
    access: crate::discord::DiscordAccess::new(
      crate::discord::OAuthClient {
        application_id: NonZeroU64::MIN,
        secret: "fixture".into(),
      },
      serenity::all::UserId::new(42),
      Arc::clone(&http),
    )?,
    proxy: base.proxy,
    application: base.application,
    sockets: base.sockets,
    voice_changed: base.voice_changed,
    slots: base.slots,
    sessions: base.sessions,
    now: base.now,
  });
  // Creating these production-typed futures performs no Discord request; they are never polled.
  let authentication = authenticate(
    State(Arc::clone(&state)),
    HeaderMap::new(),
    Json(ReadSettings {
      guild_id: "1".into(),
      code: "fixture".into(),
    }),
  );
  let commands = crate::commands::Commands::new(Arc::clone(&state.application), None);
  let interaction = serde_json::from_value(json!({
    "id":"9", "application_id":"42", "type":2,
    "data":{"id":"7", "name":"emote-compose", "type":1},
    "channel_id":"42", "token":"fixture", "version":1,
    "locale":"en-US", "entitlements":[], "attachment_size_limit":10_485_760,
    "user":crate::tests::user("3")
  }))?;
  let command = commands.respond(&http, interaction);
  // At most eight Activity requests are admitted. Keep each future below four memory pages;
  // growth beyond this budget requires a deliberate review of captured SDK/request state.
  for (name, bytes) in [
    ("authentication", size_of_val(&authentication)),
    ("command", size_of_val(&command)),
  ] {
    assert!(bytes <= 16 * 1024, "{name} future grew to {bytes} bytes");
    println!("{name} future: {bytes} bytes");
  }
  Ok(())
}

#[tokio::test]
async fn maps_database_failures_and_bounds_concurrent_requests() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut state = Activity {
    access: TestAccess(Arc::new(AtomicUsize::new(0))),
    proxy: ProxyAuthenticator::new(&hex::encode(fixture.key.verifying_key().as_bytes()))?,
    application: Arc::new(Application::new(
      botge_domain::providers::Providers::default(),
      Arc::clone(&fixture.store),
      None,
    )?),
    voice_changed: Arc::clone(&fixture.changed),
    slots: Semaphore::new(1),
    sockets: Arc::new(Semaphore::new(GAME_SOCKETS)),
    sessions: Sessions::default(),
    now: || Ok(100),
  };
  let now = 100_u64;
  let payload = json!({"created_at":now,"expires_at":now + 60}).to_string();
  let signature = fixture.key.sign(payload.as_bytes());
  let headers = Request::builder()
    .header("x-discord-proxy-payload", STANDARD.encode(payload))
    .header("x-signature-ed25519", STANDARD.encode(signature.to_bytes()))
    .header("x-signature-timestamp", now)
    .body(())?
    .into_parts()
    .0
    .headers;
  let (_, _, permit) = state
    .validate(&headers, "1", "admin")
    .map_err(|error| anyhow::anyhow!(error.1))?;
  let error = state
    .validate(&headers, "1", "admin")
    .err()
    .context("request limit was not enforced")?;
  assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
  drop(permit);
  assert_matches!(state.validate(&headers, "1", "admin").map(|_| ()), Ok(()));
  state.now = || Ok(200);
  let error = state
    .validate(&headers, "1", "admin")
    .err()
    .context("expired signature accepted")?;
  assert_eq!(error.0, StatusCode::UNAUTHORIZED);
  state.now = || {
    UNIX_EPOCH
      .duration_since(UNIX_EPOCH + Duration::from_secs(1))
      .map(|value| value.as_secs())
  };
  let error = state
    .validate(&headers, "1", "admin")
    .err()
    .context("clock failure accepted")?;
  assert_eq!(error.0, StatusCode::INTERNAL_SERVER_ERROR);
  Ok(())
}

#[tokio::test]
async fn exchanges_codes_and_reuses_tokens_without_skipping_write_authorization()
-> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let body = json!({"guildId":"1", "code":"admin"});
  assert_eq!(
    fixture.post("/auth", &body, false).await?.0,
    StatusCode::UNAUTHORIZED
  );
  let (status, token) = fixture.post("/auth", &body, true).await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(token, json!({"accessToken":"admin", "expiresIn":3600}));
  let voice = json!({"channelId":null,"statusEnabled":false,"statusEmoji":null});
  let change = json!({"guildId":"1","voice":voice});
  for _ in 0..3 {
    assert_eq!(
      fixture
        .post_with_token("/settings/voice", &change, true, Some("Bearer admin"))
        .await?
        .0,
      StatusCode::OK
    );
  }
  assert_eq!(fixture.membership_calls.load(Ordering::Relaxed), 3);
  for (token, status) in [
    ("Bearer member", StatusCode::FORBIDDEN),
    ("Bearer expired", StatusCode::UNAUTHORIZED),
    ("Bearer ", StatusCode::BAD_REQUEST),
    ("Basic admin", StatusCode::BAD_REQUEST),
    ("Bearer invalid token", StatusCode::BAD_REQUEST),
  ] {
    assert_eq!(
      fixture
        .post_with_token("/settings/voice", &change, true, Some(token))
        .await?
        .0,
      status
    );
  }
  assert_eq!(
    fixture
      .post_with_token("/auth", &json!({"guildId":"1"}), true, Some("Bearer admin"))
      .await?
      .0,
    StatusCode::BAD_REQUEST
  );
  assert_eq!(
    fixture.store.voice_settings(NonZeroU64::MIN)?,
    serde_json::from_value(voice)?
  );
  Ok(())
}

#[tokio::test]
async fn rejects_unsigned_unauthorized_and_invalid_changes() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  for (signed, code, channel, expected) in [
    (false, "admin", "42", StatusCode::UNAUTHORIZED),
    (true, "expired", "42", StatusCode::UNAUTHORIZED),
    (true, "member", "42", StatusCode::FORBIDDEN),
    (true, "invalid code", "42", StatusCode::BAD_REQUEST),
    (true, "", "42", StatusCode::BAD_REQUEST),
    (true, &"a".repeat(513), "42", StatusCode::BAD_REQUEST),
    (true, "admin", "0", StatusCode::BAD_REQUEST),
    (true, "admin", "43", StatusCode::BAD_REQUEST),
  ] {
    let (status, body) = fixture.post("/settings/voice", &json!({
            "guildId": "1", "code": code, "voice": { "channelId": channel, "statusEnabled": false, "statusEmoji": null }
        }), signed).await?;
    assert_eq!(status, expected);
    // Only a rejected OAuth credential asks the Activity to renew; a bad proxy signature does not.
    let renew = signed && code == "expired";
    assert_eq!(body.get("code") == Some(&json!("oauth_expired")), renew);
  }
  assert_eq!(
    fixture.store.voice_settings(NonZeroU64::MIN)?,
    VoiceSettings::default()
  );
  let metrics = fixture.application.render_metrics();
  for (status, count) in [(401, 2), (403, 1), (400, 5)] {
    let series = format!(
      "botge_activity_requests_total{{route=\"/settings/voice\",status=\"{status}\"}} {count}\n"
    );
    assert!(metrics.contains(&series), "{series}");
  }
  Ok(())
}

#[test]
fn limits_each_credential_without_blocking_other_sessions() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut state = fixture.state()?;
  state.now = || Ok(100);
  let headers = validation_headers(&fixture.key)?;
  let admit = |code: &str| {
    state
      .validate(&headers, "1", code)
      .map(|(_, _, admission)| admission)
  };
  let mut held = Vec::new();
  for _ in 0..SESSION_SLOTS {
    held.push(admit("first").map_err(|error| anyhow::anyhow!(error.1))?);
  }
  let error = admit("first")
    .err()
    .context("session limit was not enforced")?;
  assert_eq!(error.0, StatusCode::TOO_MANY_REQUESTS);
  // A rejected session request must not consume a shared slot.
  assert_eq!(state.slots.available_permits(), 8 - SESSION_SLOTS);
  let other = admit("second").map_err(|error| anyhow::anyhow!(error.1))?;
  held.pop();
  assert_matches!(admit("first").map(drop), Ok(()));
  drop(held);
  drop(other);
  let finished = state
    .sessions
    .active
    .lock()
    .unwrap_or_else(PoisonError::into_inner)
    .is_empty();
  assert!(finished, "finished sessions must not stay in memory");
  Ok(())
}

#[test]
fn validates_credentials_before_admission_without_falling_back_from_a_bad_bearer()
-> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut state = fixture.state()?;
  state.now = || Ok(100);
  let mut headers = validation_headers(&fixture.key)?;
  for code in ["a".repeat(513), "a$".into(), "é".into()] {
    let error = state
      .validate(&headers, "1", &code)
      .err()
      .context("invalid code accepted")?;
    assert_eq!(error.0, StatusCode::BAD_REQUEST);
  }
  for code in ["a-b_c".to_owned(), "a".repeat(512)] {
    assert_matches!(state.validate(&headers, "1", &code), Ok(_));
  }
  for token in [
    "Bearer a!".to_owned(),
    format!("Bearer {}", "a".repeat(2049)),
  ] {
    headers.insert(
      header::AUTHORIZATION,
      header::HeaderValue::from_str(&token)?,
    );
    let error = state
      .validate(&headers, "1", "admin")
      .err()
      .context("invalid bearer fell back to code")?;
    assert_eq!(error.0, StatusCode::BAD_REQUEST);
  }
  headers.insert(
    header::AUTHORIZATION,
    header::HeaderValue::from_bytes(&[0xff])?,
  );
  assert_matches!(state.validate(&headers, "1", "admin"), Err(_));
  headers.insert(
    header::AUTHORIZATION,
    header::HeaderValue::from_str(&format!("Bearer {}", "a".repeat(2048)))?,
  );
  assert_matches!(state.validate(&headers, "1", ""), Ok(_));
  state.slots.close();
  let error = state
    .validate(&headers, "1", "")
    .err()
    .context("closed admission accepted request")?;
  assert_eq!(error.0, StatusCode::SERVICE_UNAVAILABLE);
  Ok(())
}

#[tokio::test]
async fn every_catalog_route_rejects_unsigned_input_before_application_work() -> anyhow::Result<()>
{
  let fixture = Fixture::new()?;
  for (path, body) in [
    ("/catalog", json!({"guildId":"1","code":"admin"})),
    (
      "/emotes",
      json!({"guildId":"1","code":"admin","emoteId":"01234567890123456789012345"}),
    ),
    (
      "/emotes/remove",
      json!({"guildId":"1","code":"admin","emoteId":"01234567890123456789012345"}),
    ),
    (
      "/emotes/batch",
      json!({"guildId":"1","code":"admin","action":"remove","emoteIds":["01234567890123456789012345"]}),
    ),
    (
      "/settings/emotes/read",
      json!({"guildId":"1","code":"admin"}),
    ),
    (
      "/settings/emotes",
      json!({"guildId":"1","code":"admin","emotes":{}}),
    ),
  ] {
    assert_eq!(
      fixture.post(path, &body, false).await?.0,
      StatusCode::UNAUTHORIZED,
      "{path}"
    );
  }
  assert_eq!(fixture.membership_calls.load(Ordering::Relaxed), 0);
  Ok(())
}
