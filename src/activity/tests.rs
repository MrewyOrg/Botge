//! Sends signed requests directly through the Axum router with temporary storage and fake OAuth.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use axum::{
  body::{Body, to_bytes},
  http::{Method, Request},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{Value, json};
use tower::ServiceExt as _;

use super::*;

/// Maps test authorization codes to fixed identities and guild permissions.
/// `admin` can change settings, `manager` carries role 42, and `member` has no elevated role.
/// The counter measures guild authorization independently of provider lookups.
struct TestAccess(Arc<AtomicUsize>);

/// In this fixture, codes and tokens encode the same fixed test identity.
fn fixture_identity(credential: &Credential) -> &str {
  match credential {
    Credential::Code(value) | Credential::AccessToken(value) => value,
  }
}

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
struct Fixture {
  _directory: tempfile::TempDir,
  store: Arc<Store>,
  changed: Arc<Notify>,
  membership_calls: Arc<AtomicUsize>,
  router: Router,
  key: SigningKey,
}

impl Fixture {
  fn new() -> anyhow::Result<Self> {
    Self::with_emotes(None)
  }

  /// Enables individual 7TV additions only when the caller supplies a local provider origin.
  fn with_emotes(origin: Option<reqwest::Url>) -> anyhow::Result<Self> {
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
  async fn post(
    &self,
    path: &str,
    body: &Value,
    signed: bool,
  ) -> anyhow::Result<(StatusCode, Value)> {
    self.post_with_token(path, body, signed, None).await
  }

  async fn post_with_token(
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
async fn saves_a_channel_and_clears_it_without_losing_the_status_preference() -> anyhow::Result<()>
{
  let fixture = Fixture::new()?;
  let (status, read) = fixture
    .post("/settings", &json!({"guildId": "1", "code": "admin"}), true)
    .await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(read.pointer("/voice/channelId"), Some(&Value::Null));
  assert_eq!(
    read.pointer("/channels/0/id").and_then(Value::as_str),
    Some("42")
  );
  for channel_id in [Some("42"), None] {
    let settings =
      json!({ "channelId": channel_id, "statusEnabled": true, "statusEmoji": "<:Botge:123>" });
    let (status, response) = fixture
      .post(
        "/settings/voice",
        &json!({
            "guildId": "1", "code": "admin", "voice": settings
        }),
        true,
      )
      .await?;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(response.get("voice"), Some(&settings));
    tokio::time::timeout(Duration::from_secs(1), fixture.changed.notified()).await?;
    let saved = fixture.store.voice_settings(NonZeroU64::MIN)?;
    assert_eq!(saved.channel_id.as_deref(), channel_id);
    assert_eq!(saved.status(), Some("<:Botge:123>"));
  }
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

#[tokio::test]
async fn serves_a_guild_catalog_and_allows_only_authorized_adds_and_removals() -> anyhow::Result<()>
{
  let id = "01234567890123456789012345";
  let upstream = crate::tests::TestServer::start(Router::new().route(
    "/v3/emotes/{id}",
    get(
      move |axum::extract::Path(requested): axum::extract::Path<String>| async move {
        if requested != id {
          return Err(StatusCode::NOT_FOUND);
        }
        Ok(Json(
          json!({"id":id,"name":"Wave","animated":false,"flags":0,"listed":true,
                "host":{"files":[{"name":"2x.png"}]}}),
        ))
      },
    ),
  ))
  .await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let admin = json!({"guildId":"1","code":"admin","emoteId":id});
  let member = json!({"guildId":"1","code":"member","emoteId":id});
  assert_eq!(
    fixture.post("/emotes", &member, true).await?.0,
    StatusCode::FORBIDDEN
  );
  assert_eq!(
    fixture
      .post(
        "/emotes",
        &json!({"guildId":"1","code":"admin","emoteId":"bad"}),
        true
      )
      .await?
      .0,
    StatusCode::BAD_REQUEST
  );
  assert_eq!(
    fixture
      .post(
        "/emotes",
        &json!({"guildId":"1","code":"admin","emoteId":"000000000000000000000000"}),
        true
      )
      .await?
      .0,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    fixture.post("/emotes", &admin, true).await?.0,
    StatusCode::CREATED
  );
  assert_eq!(
    fixture.post("/emotes", &admin, true).await?.0,
    StatusCode::CONFLICT
  );
  let (_, catalog) = fixture
    .post("/catalog", &json!({"guildId":"1","code":"member"}), true)
    .await?;
  assert_eq!(
    catalog
      .pointer("/emotes/0/sevenTVId")
      .and_then(Value::as_str),
    Some(id)
  );
  assert_eq!(catalog.get("canManageEmotes"), Some(&Value::Bool(false)));
  let (_, other) = fixture
    .post("/catalog", &json!({"guildId":"2","code":"admin"}), true)
    .await?;
  assert_eq!(other.get("emotes"), Some(&json!([])));
  assert_eq!(
    fixture.post("/emotes/remove", &member, true).await?.0,
    StatusCode::FORBIDDEN
  );

  let access = json!({"allowEveryone":true});
  let save = json!({"guildId":"1","code":"admin","emotes": access});
  assert_eq!(
    fixture.post("/settings/emotes", &save, true).await?.0,
    StatusCode::OK
  );
  let (status, settings) = fixture
    .post(
      "/settings/emotes/read",
      &json!({"guildId":"1","code":"admin"}),
      true,
    )
    .await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(settings.get("allowEveryone"), Some(&Value::Bool(true)));
  assert_eq!(
    fixture
      .post(
        "/settings/emotes/read",
        &json!({"guildId":"1","code":"member"}),
        true
      )
      .await?
      .0,
    StatusCode::FORBIDDEN
  );
  assert_eq!(
    fixture
      .post(
        "/settings/emotes",
        &json!({"guildId":"1","code":"admin","emotes":{"ffzChannel":"x/y"}}),
        true
      )
      .await?
      .0,
    StatusCode::BAD_REQUEST
  );

  let (status, body) = fixture.post("/emotes/remove", &member, true).await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body.get("removed"), Some(&Value::Bool(true)));
  assert_eq!(
    fixture.post("/emotes/remove", &member, true).await?.0,
    StatusCode::NOT_FOUND
  );

  let disabled = Fixture::new()?;
  assert_eq!(
    disabled.post("/emotes", &admin, true).await?.0,
    StatusCode::FORBIDDEN
  );
  Ok(())
}

#[tokio::test]
async fn retries_a_failed_emote_add_without_leaving_a_record() -> anyhow::Result<()> {
  let id = "01234567890123456789012345";
  let available = Arc::new(AtomicBool::new(false));
  let upstream = crate::tests::TestServer::start(Router::new().route(
    "/v3/emotes/{id}",
    get({
      let available = Arc::clone(&available);
      move || async move {
        if !available.load(Ordering::Relaxed) {
          return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        Ok(Json(json!({
            "id":id,"name":"Wave","animated":false,"flags":0,"listed":true,
            "host":{"files":[{"name":"2x.png"}]}
        })))
      }
    }),
  ))
  .await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let add = json!({"guildId":"1","code":"admin","emoteId":id});

  assert_eq!(
    fixture.post("/emotes", &add, true).await?.0,
    StatusCode::BAD_GATEWAY
  );
  assert!(fixture.store.added_emotes(NonZeroU64::MIN)?.is_empty());
  available.store(true, Ordering::Relaxed);
  assert_eq!(
    fixture.post("/emotes", &add, true).await?.0,
    StatusCode::CREATED
  );
  assert_eq!(
    fixture
      .store
      .added_emotes(NonZeroU64::MIN)?
      .first()
      .map(|emote| emote.id.as_str()),
    Some(id)
  );
  Ok(())
}

#[tokio::test]
async fn a_delegated_emote_manager_can_remove_emotes_but_cannot_change_settings()
-> anyhow::Result<()> {
  let upstream = crate::tests::TestServer::start(Router::new()).await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let id = "01234567890123456789012345";
  assert!(
    fixture
      .store
      .add_emote(NonZeroU64::MIN, crate::emotes::tests::example("Wave", id))?
  );

  let remove = json!({"guildId":"1","code":"manager","emoteId":id});
  assert_eq!(
    fixture.post("/emotes/remove", &remove, true).await?.0,
    StatusCode::FORBIDDEN
  );

  let grant_role = json!({"guildId":"1","code":"admin","emotes":{"allowedRoles":["42"]}});
  assert_eq!(
    fixture.post("/settings/emotes", &grant_role, true).await?.0,
    StatusCode::OK
  );
  let (_, catalog) = fixture
    .post("/catalog", &json!({"guildId":"1","code":"manager"}), true)
    .await?;
  assert_eq!(catalog.get("canManageEmotes"), Some(&Value::Bool(true)));
  let expand_access = json!({"guildId":"1","code":"manager","emotes":{"allowEveryone":true}});
  assert_eq!(
    fixture
      .post("/settings/emotes", &expand_access, true)
      .await?
      .0,
    StatusCode::FORBIDDEN
  );

  assert_eq!(
    fixture.post("/emotes/remove", &remove, true).await?.0,
    StatusCode::OK
  );
  assert!(fixture.store.added_emotes(NonZeroU64::MIN)?.is_empty());
  Ok(())
}

#[tokio::test]
async fn stores_an_optional_border_for_the_authenticated_user() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let read = json!({"guildId":"1","code":"member"});
  let save = |code: &str, color: &str| json!({"guildId":"1","code":code,"color":color});
  assert_eq!(
    fixture.post("/settings/border/read", &read, true).await?,
    (StatusCode::OK, json!({"color":""}))
  );
  assert_eq!(
    fixture
      .post("/settings/border", &save("member", "#ff7700"), false)
      .await?
      .0,
    StatusCode::UNAUTHORIZED
  );
  assert_eq!(
    fixture
      .post("/settings/border", &save("bad", "#ff7700"), true)
      .await?
      .0,
    StatusCode::UNAUTHORIZED
  );
  assert_eq!(
    fixture
      .post("/settings/border", &save("member", "red"), true)
      .await?
      .0,
    StatusCode::BAD_REQUEST
  );
  assert_eq!(
    fixture
      .post("/settings/border", &save("member", "#ff7700"), true)
      .await?,
    (StatusCode::OK, json!({"color":"FF7700"}))
  );
  assert_eq!(
    fixture.post("/settings/border/read", &read, true).await?.1,
    json!({"color":"FF7700"})
  );
  assert_eq!(fixture.store.emote_border(NonZeroU64::MIN)?, None);
  assert_eq!(
    fixture
      .post("/settings/border", &save("member", ""), true)
      .await?
      .1,
    json!({"color":""})
  );
  assert_eq!(fixture.store.emote_border(NonZeroU64::MAX)?, None);
  Ok(())
}

#[tokio::test]
async fn changes_a_batch_with_one_authorization_and_reports_partial_results() -> anyhow::Result<()>
{
  let first = "01234567890123456789012345";
  let second = "01234567890123456789012346";
  let missing = "01234567890123456789012347";
  let upstream = crate::tests::TestServer::start(Router::new().route(
    "/v3/emotes/{id}",
    get(
      move |axum::extract::Path(id): axum::extract::Path<String>| async move {
        let name = match id.as_str() {
          value if value == first => "First",
          value if value == second => "Second",
          _ => return Err(StatusCode::NOT_FOUND),
        };
        Ok(Json(
          json!({"id":id,"name":name,"animated":false,"flags":256,"listed":true,
                "tags":["Test"],"host":{"files":[{"name":"2x.png"}]}}),
        ))
      },
    ),
  ))
  .await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let request = |code: &str, action: &str, ids: &[&str]| json!({"guildId":"1","code":code,"action":action,"emoteIds":ids});
  assert_eq!(
    fixture
      .post("/emotes/batch", &request("member", "add", &[first]), true)
      .await?
      .0,
    StatusCode::FORBIDDEN
  );
  for invalid in [&[][..], &[first, first], &["bad-id"], &[first; 13]] {
    assert_eq!(
      fixture
        .post("/emotes/batch", &request("admin", "add", invalid), true)
        .await?
        .0,
      StatusCode::BAD_REQUEST
    );
  }
  assert_eq!(fixture.membership_calls.load(Ordering::Relaxed), 1);
  assert!(fixture.store.added_emotes(NonZeroU64::MIN)?.is_empty());
  let (status, added) = fixture
    .post(
      "/emotes/batch",
      &request("admin", "add", &[first, missing, second]),
      true,
    )
    .await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(fixture.membership_calls.load(Ordering::Relaxed), 2);
  assert_eq!(added.pointer("/0/emoteId"), Some(&json!(first)));
  assert_eq!(added.pointer("/1/emoteId"), Some(&json!(missing)));
  assert_eq!(added.pointer("/2/emoteId"), Some(&json!(second)));
  assert_eq!(added.pointer("/0/ok"), Some(&json!(true)));
  assert_eq!(added.pointer("/1/ok"), Some(&json!(false)));
  assert_eq!(added.pointer("/2/ok"), Some(&json!(true)));
  let (_, catalog) = fixture
    .post("/catalog", &json!({"guildId":"1","code":"admin"}), true)
    .await?;
  assert_eq!(catalog.pointer("/canComposeDiscovery"), Some(&json!(true)));
  assert_eq!(catalog.pointer("/emotes/0/overlaying"), Some(&json!(true)));
  assert_eq!(catalog.pointer("/emotes/0/tags/0"), Some(&json!("Test")));
  let (_, settings) = fixture
    .post(
      "/settings/emotes/read",
      &json!({"guildId":"1","code":"admin"}),
      true,
    )
    .await?;
  assert_eq!(
    settings.pointer("/roles/0/name"),
    Some(&json!("Emote manager"))
  );
  let membership_calls = fixture.membership_calls.load(Ordering::Relaxed);
  let (_, removed) = fixture
    .post(
      "/emotes/batch",
      &request("admin", "remove", &[first, second, missing]),
      true,
    )
    .await?;
  assert_eq!(
    fixture.membership_calls.load(Ordering::Relaxed),
    membership_calls + 1
  );
  assert_eq!(removed.pointer("/0/ok"), Some(&json!(true)));
  assert_eq!(removed.pointer("/1/ok"), Some(&json!(true)));
  assert_eq!(removed.pointer("/2/ok"), Some(&json!(false)));
  assert!(fixture.store.added_emotes(NonZeroU64::MIN)?.is_empty());
  Ok(())
}
