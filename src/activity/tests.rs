//! Sends signed requests directly through the Axum router with temporary storage and fake OAuth.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::Context as _;
use axum::{
  body::{Body, to_bytes},
  http::{Method, Request},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{Value, json};
use tower::ServiceExt as _;

use super::*;
use crate::settings::VoiceSettings;

#[tokio::test]
async fn maps_database_failures_and_bounds_concurrent_requests() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let state = Activity {
    access: TestAccess(Arc::new(AtomicUsize::new(0))),
    proxy: ProxyAuthenticator::new(&hex::encode(fixture.key.verifying_key().as_bytes()))?,
    store: Arc::clone(&fixture.store),
    emotes: Arc::new(Emotes::new(
      crate::config::Providers::default(),
      Arc::clone(&fixture.store),
      None,
    )?),
    voice_changed: Arc::clone(&fixture.changed),
    slots: Semaphore::new(1),
  };
  let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
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
  assert!(state.validate(&headers, "1", "admin").is_ok());
  let error = database::<()>(|| anyhow::bail!("fixture database unavailable"))
    .await
    .err()
    .context("database error was lost")?;
  assert_eq!(error.0, StatusCode::INTERNAL_SERVER_ERROR);
  Ok(())
}

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
  async fn exchange_code(&self, code: &str) -> Result<AccessToken, ApiError> {
    self.user_id(&Credential::Code(code.into())).await?;
    Ok(AccessToken {
      access_token: code.into(),
      expires_in: 3600,
    })
  }

  async fn user_id(&self, credential: &Credential) -> Result<NonZeroU64, ApiError> {
    let code = fixture_identity(credential);
    match code {
      "admin" => Ok(NonZeroU64::MIN),
      "member" => Ok(NonZeroU64::MAX),
      _ => Err(ApiError::UNAUTHORIZED),
    }
  }

  async fn membership(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Membership, ApiError> {
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
      _ => Err(ApiError::UNAUTHORIZED),
    }
  }
  async fn voice_channels(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Vec<VoiceChannel>, ApiError> {
    self.0.fetch_add(1, Ordering::Relaxed);
    let code = fixture_identity(credential);
    match code {
      "admin" => Ok(vec![VoiceChannel {
        id: "42".into(),
        name: "Voice".into(),
      }]),
      "member" => Err(ApiError::FORBIDDEN),
      _ => Err(ApiError::UNAUTHORIZED),
    }
  }
}

/// Owns the router, signing key, and temporary database for a single test.
pub(super) struct Fixture {
  _directory: tempfile::TempDir,
  pub(super) store: Arc<Store>,
  pub(super) changed: Arc<Notify>,
  pub(super) membership_calls: Arc<AtomicUsize>,
  router: Router,
  key: SigningKey,
}

impl Fixture {
  /// Builds the same shared services for deterministic checks below the HTTP adapter.
  pub(super) fn state(&self) -> anyhow::Result<Activity<TestAccess>> {
    Ok(Activity {
      access: TestAccess(Arc::clone(&self.membership_calls)),
      proxy: ProxyAuthenticator::new(&hex::encode(self.key.verifying_key().as_bytes()))?,
      store: Arc::clone(&self.store),
      emotes: Arc::new(Emotes::new(
        crate::config::Providers::default(),
        Arc::clone(&self.store),
        None,
      )?),
      voice_changed: Arc::clone(&self.changed),
      slots: Semaphore::new(8),
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
    let mut emotes = Emotes::new(
      crate::config::Providers {
        seven_added: origin.is_some(),
        ..Default::default()
      },
      Arc::clone(&store),
      None,
    )?;
    if let Some(origin) = origin {
      emotes.use_provider_fixture(origin);
    }
    let emotes = Arc::new(emotes);
    let membership_calls = Arc::new(AtomicUsize::new(0));
    let router = router(
      Arc::clone(&store),
      emotes,
      Arc::clone(&changed),
      proxy,
      TestAccess(Arc::clone(&membership_calls)),
    );
    Ok(Self {
      _directory: directory,
      store,
      changed,
      membership_calls,
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
    let (status, _) = fixture.post("/settings/voice", &json!({
            "guildId": "1", "code": code, "voice": { "channelId": channel, "statusEnabled": false, "statusEmoji": null }
        }), signed).await?;
    assert_eq!(status, expected);
  }
  assert_eq!(
    fixture.store.voice_settings(NonZeroU64::MIN)?,
    VoiceSettings::default()
  );
  Ok(())
}
