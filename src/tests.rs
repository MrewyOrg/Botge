//! Shared loopback fixtures and tests that exercise the bot's service lifecycle.

use axum::Router;
use reqwest::Url;
use tokio::{net::TcpListener, task::JoinHandle};

/// An HTTP fixture that owns its server task and aborts it on drop.
pub(crate) struct TestServer {
  pub(crate) origin: Url,
  task: JoinHandle<()>,
}

impl TestServer {
  /// Binds the router to an ephemeral loopback port and returns its base URL.
  pub(crate) async fn start(router: Router) -> anyhow::Result<Self> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = Url::parse(&format!("http://{}", listener.local_addr()?))?;
    let task = tokio::spawn(async move {
      let _ = axum::serve(listener, router).await;
    });
    Ok(Self { origin, task })
  }
}

impl Drop for TestServer {
  fn drop(&mut self) {
    self.task.abort();
  }
}

use std::{collections::HashMap, time::Duration};

use axum::{
  Json,
  http::StatusCode,
  routing::{get, patch, post, put},
};
use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio_tungstenite::{accept_async, tungstenite::Message};

use super::*;

/// Builds a Discord user fixture. ID `42` represents Botge itself.
pub(crate) fn user(id: &str) -> Value {
  json!({ "id": id, "username": "Fixture", "bot": id == "42" })
}

/// Points Serenity's REST client at the local fixture and disables its rate limiter.
pub(crate) fn http_for(server: &TestServer) -> Http {
  serenity::http::HttpBuilder::new("fixture")
    .proxy(server.origin.as_str())
    .ratelimiter_disabled(true)
    .application_id(serenity::all::ApplicationId::new(42))
    .build()
}

fn dispatch(event: &str, sequence: u64, data: Value) -> Message {
  Message::Text(
    json!({"op":0, "t":event, "s":sequence, "d":data})
      .to_string()
      .into(),
  )
}

/// Simulates Discord's gateway handshake and forwards requested voice channels to the test.
async fn gateway(
  socket: tokio::net::TcpStream,
  url: &str,
  states: mpsc::UnboundedSender<Value>,
) -> Result<()> {
  let mut socket = accept_async(socket).await?;
  socket
    .send(Message::Text(
      r#"{"op":10,"d":{"heartbeat_interval":45000}}"#.into(),
    ))
    .await?;
  let mut sequence = 0;
  let mut joined = false;
  while let Some(message) = socket.next().await {
    let message = message?;
    if message.is_close() {
      break;
    }
    let Ok(payload) = serde_json::from_str::<Value>(message.to_text()?) else {
      continue;
    };
    match payload.get("op").and_then(Value::as_u64) {
      Some(2) => {
        sequence += 1;
        socket
          .send(dispatch(
            "READY",
            sequence,
            json!({
                "v":10,"user":user("42"),"guilds":[{"id":"1","unavailable":false}],
                "session_id":"fixture","resume_gateway_url":url,"application":{"id":"42","flags":0}
            }),
          ))
          .await?;
        sequence += 1;
        socket
          .send(dispatch("RESUMED", sequence, json!({})))
          .await?;
        sequence += 1;
        socket.send(dispatch("INTERACTION_CREATE", sequence, json!({
                    "type":2, "id":"9","application_id":"42","data":{"id":"7","name":"emote-shortcuts","type":1},
                    "guild_id":"1","channel_id":"42","token":"interaction","version":1,
                    "locale":"en-US","entitlements":[],"attachment_size_limit":10485760
                }))).await?;
        let intents = payload
          .pointer("/d/intents")
          .and_then(Value::as_u64)
          .unwrap_or_default();
        assert_ne!(intents & GatewayIntents::MESSAGE_CONTENT.bits(), 0);
        // Exercise the bot-author and spaced-prefix filters before sending a valid shortcut.
        for (id, author, content) in [
          (10, "42", "+Wave"),
          (11, "3", "+ Wave"),
          (12, "3", "+Wave Wave:96"),
        ] {
          let mut message = serde_json::to_value(serenity::all::Message::default())?;
          let fields = message.as_object_mut().context("missing message fields")?;
          fields.extend([
            ("id".into(), json!(id.to_string())),
            ("author".into(), user(author)),
            ("guild_id".into(), json!("1")),
            ("channel_id".into(), json!("42")),
            ("content".into(), json!(content)),
          ]);
          sequence += 1;
          socket
            .send(dispatch("MESSAGE_CREATE", sequence, message))
            .await?;
        }
      }
      Some(4) => {
        let channel = payload
          .pointer("/d/channel_id")
          .cloned()
          .unwrap_or(Value::Null);
        if channel.is_null() && !joined {
          continue;
        }
        let _ = states.send(channel.clone());
        sequence += 1;
        socket.send(dispatch("VOICE_STATE_UPDATE", sequence, json!({
                    "guild_id":"1","channel_id":channel,"user_id":"42","session_id":"fixture",
                    "deaf":false,"mute":false,"self_deaf":false,"self_mute":true,"self_video":false,"suppress":false
                }))).await?;
        if !channel.is_null() {
          joined = true;
          sequence += 1;
          // Acknowledge the gateway join while leaving the media endpoint unavailable.
          socket
            .send(dispatch(
              "VOICE_SERVER_UPDATE",
              sequence,
              json!({"guild_id":"1","token":"voice","endpoint":"127.0.0.1:1"}),
            ))
            .await?;
        }
      }
      Some(1) => {
        socket
          .send(Message::Text(r#"{"op":11,"d":null}"#.into()))
          .await?
      }
      _ => (),
    }
  }
  Ok(())
}

#[test]
fn loads_runtime_configuration_and_rejects_partial_activity_credentials() -> Result<()> {
  assert!(Options::read(|_| None).is_err());
  let mut env = HashMap::from([("DISCORD_TOKEN", "fixture")]);
  let options = Options::read(|key| env.get(key).map(ToString::to_string))?;
  assert!(options.activity.is_none());
  assert!(!options.prefix_compose);
  assert_eq!(options.data, PathBuf::from("data"));
  env.insert("HEALTH_BIND_HOST", "invalid");
  assert!(Options::read(|key| env.get(key).map(ToString::to_string)).is_err());
  env.remove("HEALTH_BIND_HOST");
  env.insert("DISCORD_ACTIVITY_CLIENT_SECRET", "fixture");
  assert!(Options::read(|key| env.get(key).map(ToString::to_string)).is_err());
  env.insert("DISCORD_ACTIVITY_PUBLIC_KEY", "fixture");
  assert!(Options::read(|key| env.get(key).map(ToString::to_string)).is_err());
  env.insert("DISCORD_ACTIVITY_CLIENT_SECRET", "");
  env.insert("APP_ID", "42");
  assert!(Options::read(|key| env.get(key).map(ToString::to_string)).is_err());
  env.insert("DISCORD_ACTIVITY_CLIENT_SECRET", "fixture");
  env.extend([
    ("APP_ID", "42"),
    ("BOTGE_DATA_DIR", "/fixture"),
    ("LOCAL_CACHE_BASE", "http://nginx"),
    ("TWITCH_CLIENT_ID", "id"),
    ("TWITCH_SECRET", "secret"),
    ("BOTGE_REGISTER_COMMANDS", "true"),
    ("BOTGE_ENABLE_PREFIX_COMPOSE", "true"),
  ]);
  let options = Options::read(|key| env.get(key).map(ToString::to_string))?;
  assert_eq!(
    options.activity.map(|api| api.address.to_string()),
    Some("127.0.0.1:3080".into())
  );
  assert!(options.twitch.is_some() && options.cache.is_some() && options.register_commands);
  assert!(options.prefix_compose);
  env.insert("ACTIVITY_BIND_HOST", "invalid");
  assert!(Options::read(|key| env.get(key).map(ToString::to_string)).is_err());
  env.insert("ACTIVITY_BIND_HOST", "::1");
  assert!(Options::read(|key| env.get(key).map(ToString::to_string)).is_ok());
  env.insert("LOCAL_CACHE_BASE", "invalid");
  assert!(Options::read(|key| env.get(key).map(ToString::to_string)).is_err());
  Ok(())
}

#[test]
fn only_requests_message_content_when_prefix_compose_is_enabled() {
  let default = GatewayIntents::GUILDS | GatewayIntents::GUILD_VOICE_STATES;
  assert_eq!(gateway_intents(false), default);
  assert_eq!(
    gateway_intents(true),
    default
      | GatewayIntents::GUILD_MESSAGES
      | GatewayIntents::DIRECT_MESSAGES
      | GatewayIntents::MESSAGE_CONTENT
  );
}

#[tokio::test]
async fn starts_gateway_and_http_reconciles_voice_and_handles_shutdown() -> Result<()> {
  let _ = tracing_subscriber::fmt()
    .with_max_level(tracing::Level::WARN)
    .with_test_writer()
    .try_init();
  let dir = tempfile::tempdir()?;
  let db = dir.path().join("botge.redb");
  let guild = NonZeroU64::MIN;
  let mut voice = settings::VoiceSettings {
    channel_id: Some("42".into()),
    status_enabled: true,
    status_emoji: Some("wave".into()),
  };
  {
    let store = Store::open(&db)?;
    store.save_voice_settings(guild, &voice)?;
    store.add_emote(guild, emotes::tests::example("Wave", "1"))?;
  }

  let listener = TcpListener::bind("127.0.0.1:0").await?;
  let url = format!("ws://{}", listener.local_addr()?);
  let (state_tx, mut state_rx) = mpsc::unbounded_channel();
  let gateway_url = url.clone();
  let ws = tokio::spawn(async move {
    let (stream, _) = listener.accept().await?;
    gateway(stream, &gateway_url, state_tx).await
  });

  let bind = TcpListener::bind("127.0.0.1:0").await?;
  let activity_address = bind.local_addr()?;
  drop(bind);
  let (status_tx, mut status_rx) = mpsc::unbounded_channel();
  let (reply_tx, mut reply_rx) = mpsc::unbounded_channel();
  let (message_tx, mut message_rx) = mpsc::unbounded_channel();
  use base64::{Engine as _, engine::general_purpose::STANDARD};
  let pixel = STANDARD.decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XioAAAAASUVORK5CYII=",
  )?;
  let http = TestServer::start(
    discord::tests::fixture_routes()
      .route(
        "/api/v10/gateway",
        get(move || async move { Json(json!({"url":url})) }),
      )
      .route(
        "/api/v10/channels/42/voice-status",
        put(move |Json(body): Json<Value>| async move {
          let _ = status_tx.send(body);
          StatusCode::NO_CONTENT
        }),
      )
      .route(
        "/api/v10/interactions/9/interaction/callback",
        post(|| async { StatusCode::NO_CONTENT }),
      )
      .route("/7tv/emote/1/2x.png", get(move || async move { pixel }))
      .route(
        "/api/v10/channels/42/messages",
        post(move |body: axum::body::Bytes| async move {
          let _ = message_tx.send(body);
          Json(serenity::all::Message::default())
        }),
      )
      .route(
        "/api/v10/webhooks/42/interaction/messages/@original",
        patch(move |Json(body): Json<Value>| async move {
          let _ = reply_tx.send(body);
          StatusCode::BAD_REQUEST
        }),
      ),
  )
  .await?;
  let key = ed25519_dalek::SigningKey::from_bytes(&[23; 32]);
  let options = Options {
    token: "fixture".into(),
    data: dir.path().into(),
    twitch: None,
    cache: Some(http.origin.clone()),
    register_commands: false,
    prefix_compose: true,
    health_address: "127.0.0.1:0".parse()?,
    activity: Some(ActivityOptions {
      secret: "fixture".into(),
      public_key: hex::encode(key.verifying_key().as_bytes()),
      application_id: NonZeroU64::MIN,
      address: activity_address,
    }),
  };
  let (cancel, shutdown) = tokio::sync::oneshot::channel();
  let config_path = dir.path().join("botge.config.json");
  std::fs::write(&config_path, r#"{"general":{"use7TVAddedEmotes":true}}"#)?;
  let runtime = tokio::spawn(async move {
    run(options, http_for(&http), &config_path, async {
      let _ = shutdown.await;
      Ok(())
    })
    .await
  });

  let result = async {
    while let Some(channel) = state_rx.recv().await {
      if channel == json!(42) || channel == json!("42") {
        break;
      }
    }
    assert_eq!(status_rx.recv().await, Some(json!({"status":"wave"})));
    assert!(
      reply_rx
        .recv()
        .await
        .and_then(|reply| reply.get("content").cloned())
        .and_then(|content| content.as_str().map(ToString::to_string))
        .is_some_and(|content| content.contains("No unique emote names matched"))
    );
    let reply = message_rx.recv().await.context("missing prefix reply")?;
    let png = reply
      .windows(8)
      .position(|chunk| chunk == b"\x89PNG\r\n\x1a\n")
      .context("missing PNG attachment")?;
    // Two 96 px emotes and a 6 px gap.
    assert_eq!(
      reply.get(png + 16..png + 24),
      Some(
        [198_u32.to_be_bytes(), 96_u32.to_be_bytes()]
          .concat()
          .as_slice()
      )
    );
    let reply = String::from_utf8_lossy(&reply);
    assert!(reply.contains("emotes.png"));
    assert!(reply.contains(r#""message_id":"12""#));
    assert!(reply.contains(r#""replied_user":false"#));
    assert!(message_rx.try_recv().is_err());
    let http = reqwest::Client::new();
    assert_eq!(
      http
        .get(format!("http://{activity_address}/healthz"))
        .send()
        .await?
        .status(),
      StatusCode::NO_CONTENT
    );

    use ed25519_dalek::Signer as _;
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)?
      .as_secs();
    let payload = json!({"created_at":now,"expires_at":now + 60}).to_string();
    let signature = key.sign(payload.as_bytes());
    let response = http.post(format!("http://{activity_address}/settings/voice"))
            .header("x-discord-proxy-payload", STANDARD.encode(payload))
            .header("x-signature-ed25519", STANDARD.encode(signature.to_bytes()))
            .header("x-signature-timestamp", now)
            .json(&json!({"guildId":"1","code":"owner","voice":{"channelId":null,"statusEnabled":true,"statusEmoji":"wave"}}))
            .send().await?;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(state_rx.recv().await, Some(Value::Null));
    Ok::<_, anyhow::Error>(())
  };
  let result = tokio::time::timeout(Duration::from_secs(15), result).await;
  let _ = cancel.send(());
  let runtime = tokio::time::timeout(Duration::from_secs(5), runtime).await?;
  ws.abort();
  runtime??;
  result.context("gateway fixture did not receive a voice or interaction update")??;
  voice.channel_id = None;
  let store = Store::open(&db)?;
  assert_eq!(store.voice_settings(guild)?, voice);
  Ok(())
}

#[tokio::test]
async fn keeps_disabled_activity_idle_and_rejects_invalid_api_configuration() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&dir.path().join("botge.redb"))?);
  let emotes = Arc::new(emotes::Emotes::new(
    config::Providers::default(),
    Arc::clone(&store),
    None,
  )?);
  let http = Arc::new(Http::new("fixture"));
  let changed = Arc::new(Notify::new());
  assert!(
    activity_server(
      None,
      &http,
      Arc::clone(&store),
      Arc::clone(&emotes),
      Arc::clone(&changed)
    )
    .await?
    .is_none()
  );
  let activity = ActivityOptions {
    secret: "fixture".into(),
    public_key: "bad-key".into(),
    application_id: NonZeroU64::MIN,
    address: "127.0.0.1:0".parse()?,
  };
  assert!(
    activity_server(Some(activity), &http, store, emotes, changed)
      .await
      .is_err()
  );
  assert!(
    tokio::time::timeout(Duration::from_millis(1), serve_activity(None))
      .await
      .is_err()
  );
  assert!(
    tokio::time::timeout(Duration::from_millis(1), shutdown_signal())
      .await
      .is_err()
  );
  Ok(())
}

#[tokio::test]
async fn refuses_to_start_with_an_unusable_data_path_or_invalid_config() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let config_path = directory.path().join("botge.config.json");
  std::fs::write(&config_path, "invalid JSON")?;
  for (data, expected) in [
    (config_path.clone(), "could not create the data directory"),
    (directory.path().join("data"), "invalid configuration"),
  ] {
    let mut options = Options::read(|key| (key == "DISCORD_TOKEN").then(|| "fixture".into()))?;
    options.data = data;
    let result = run(
      options,
      Http::new("fixture"),
      &config_path,
      std::future::pending(),
    )
    .await;
    let error = result
      .err()
      .context("invalid startup configuration was accepted")?;
    assert!(error.to_string().contains(expected));
  }
  Ok(())
}
