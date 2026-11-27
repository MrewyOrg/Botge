//! Exercises `/quantum-emote` against loopback sidecar, media and Discord fixtures.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::sync::{Arc, Mutex};

use anyhow::Context as _;
use axum::{
  Json, Router,
  body::Bytes,
  http::StatusCode,
  routing::{delete, get, patch, post},
};
use botge_app::Application;
use botge_test_support::{TestServer, example};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::*;
use crate::commands::NAMES;

/// Guild-addition catalog with two base and two overlay emotes, plus a sidecar, media and Discord
/// webhook fixture that records every request.
struct Fixture {
  _directory: tempfile::TempDir,
  store: Arc<crate::storage::Store>,
  commands: Commands,
  server: TestServer,
  /// The sidecar's next status and body.
  answer: Arc<Mutex<(u16, Value)>>,
  /// Request bodies the sidecar received.
  sampled: Arc<Mutex<Vec<Value>>>,
  /// Discord webhook calls as `(method, body)`.
  discord: mpsc::UnboundedReceiver<(&'static str, Bytes)>,
}

const GUILD: NonZeroU64 = NonZeroU64::MIN;

impl Fixture {
  async fn new() -> Result<Self> {
    let pixel = crate::tests::png_pixel()?;
    let answer = Arc::new(Mutex::new((
      200,
      json!({"mode": "entangle", "qubits": 2, "base_index": 1, "overlay_index": 0}),
    )));
    let sampled = Arc::new(Mutex::new(Vec::new()));
    let (calls, discord) = mpsc::unbounded_channel();
    let (edits, deletes) = (calls.clone(), calls.clone());
    let (reply, log) = (Arc::clone(&answer), Arc::clone(&sampled));
    let server = TestServer::start(
      Router::new()
        .route(
          "/v1/entangle",
          post(move |Json(body): Json<Value>| {
            let (reply, log) = (Arc::clone(&reply), Arc::clone(&log));
            async move {
              if let Ok(mut log) = log.lock() {
                log.push(body);
              }
              let (status, body) = reply
                .lock()
                .map_or((500, Value::Null), |reply| reply.clone());
              (
                StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                Json(body),
              )
            }
          }),
        )
        .route("/7tv/emote/{id}/2x.png", get(move || async move { pixel }))
        .route(
          "/api/v10/interactions/9/fixture/callback",
          post(|| async { StatusCode::NO_CONTENT }),
        )
        .route(
          "/api/v10/webhooks/42/fixture/messages/@original",
          patch(move |body: Bytes| async move {
            drop(edits.send(("edit", body)));
            Json(serenity::all::Message::default())
          })
          .merge(delete(move || async move {
            drop(deletes.send(("delete", Bytes::new())));
            StatusCode::NO_CONTENT
          })),
        )
        .route(
          "/api/v10/webhooks/42/fixture",
          post(move |body: Bytes| async move {
            drop(calls.send(("followup", body)));
            Json(serenity::all::Message::default())
          }),
        ),
    )
    .await?;
    let directory = tempfile::tempdir()?;
    let store = Arc::new(crate::storage::Store::open(
      &directory.path().join("botge.redb"),
    )?);
    for (name, emote_id, overlaying) in [
      ("Wave", "1", false),
      ("Smile", "2", false),
      ("Hat", "3", true),
      ("Glasses", "4", true),
    ] {
      let mut emote = example(name, emote_id);
      emote.overlaying = overlaying;
      store.add_emote(botge_storage::CatalogEditor::system(GUILD), emote)?;
    }
    let mut application = Application::new(
      botge_domain::providers::Providers {
        seven_added: true,
        ..Default::default()
      },
      Arc::clone(&store),
    )?;
    application.use_provider_fixture(server.origin.clone());
    let commands = Commands::new(Arc::new(application), Some(server.origin.clone()))
      .with_quantum(QuantumClient::new(&server.origin, None)?);
    Ok(Self {
      _directory: directory,
      store,
      commands,
      server,
      answer,
      sampled,
      discord,
    })
  }

  fn answer(&self, status: u16, body: Value) -> Result<()> {
    *self
      .answer
      .lock()
      .map_err(|_error| anyhow::anyhow!("poisoned"))? = (status, body);
    Ok(())
  }

  fn sampled(&self) -> Result<Vec<Value>> {
    Ok(
      self
        .sampled
        .lock()
        .map_err(|_error| anyhow::anyhow!("poisoned"))?
        .clone(),
    )
  }

  async fn draw(&self, options: Value) -> Result<Draw> {
    let client = self
      .commands
      .quantum
      .as_ref()
      .context("quantum client missing")?;
    self
      .commands
      .draw(
        client,
        &serde_json::from_value::<Vec<CommandDataOption>>(options)?,
        Some(GUILD),
        None,
      )
      .await
  }

  fn metric(&self, outcome: &str) -> Option<String> {
    let series = format!("botge_quantum_samples_total{{outcome=\"{outcome}\"}} ");
    self
      .commands
      .application
      .render_metrics()
      .lines()
      .find_map(|line| line.strip_prefix(&series).map(str::to_owned))
  }
}

fn interaction(options: &Value, limit: u32) -> Result<CommandInteraction> {
  Ok(serde_json::from_value(json!({
    "id":"9", "application_id":"42", "guild_id":"1", "channel_id":"2",
    "token":"fixture", "version":1, "locale":"en-US", "entitlements":[],
    "attachment_size_limit":limit, "user":crate::tests::user("3"),
    "data":{"id":"7", "type":1, "name":NAME, "options":options}
  }))?)
}

fn failed(draw: &Draw) -> Option<&str> {
  match draw {
    Draw::Failed(reason) => Some(reason),
    Draw::Drawn { .. } => None,
  }
}

#[tokio::test]
async fn draws_the_sampled_pair_from_the_sorted_pools_with_an_honest_caption() -> Result<()> {
  let fixture = Fixture::new().await?;
  let draw = fixture
    .draw(json!([{"name":"steps","type":4,"value":5},{"name":"size","type":4,"value":2}]))
    .await?;
  let Draw::Drawn {
    bytes,
    filename,
    caption,
  } = draw
  else {
    anyhow::bail!("quantum draw failed: {draw:?}");
  };
  // Sorted pools are [Smile, Wave] and [Glasses, Hat]; the sample selects (1, 0).
  assert_eq!(
    caption,
    "Drew `Wave` with overlay `Glasses` from one shot of a simulated 2-qubit Ising-Rx circuit \
     (5 steps)."
  );
  assert_eq!(filename, "emotes.png");
  assert_eq!(crate::tests::png_dimensions(&bytes)?, (1, 1));
  assert_eq!(
    fixture.sampled()?,
    [json!({"base_pool_size": 2, "overlay_pool_size": 2, "steps": 5})]
  );
  let default = fixture.draw(json!([])).await?;
  assert_eq!(failed(&default), None);
  assert_eq!(
    fixture.sampled()?.last(),
    Some(&json!({"base_pool_size": 2, "overlay_pool_size": 2, "steps": 3}))
  );
  assert_eq!(fixture.metric("sampled").as_deref(), Some("2"));
  Ok(())
}

#[tokio::test]
async fn rejects_out_of_range_options_and_small_pools_before_sampling() -> Result<()> {
  let fixture = Fixture::new().await?;
  for (options, reason) in [
    (
      json!([{"name":"steps","type":4,"value":0}]),
      "Choose steps from 1 to 6.",
    ),
    (
      json!([{"name":"steps","type":4,"value":7}]),
      "Choose steps from 1 to 6.",
    ),
    (
      json!([{"name":"size","type":4,"value":5}]),
      "Choose size from 1 to 4.",
    ),
  ] {
    assert_eq!(failed(&fixture.draw(options).await?), Some(reason));
  }
  let mut emotes = fixture.store.added_emotes(GUILD)?;
  emotes.retain(|emote| emote.name == "Hat");
  for emote in emotes {
    fixture
      .store
      .remove_emote(botge_storage::CatalogEditor::system(GUILD), &emote.id)?;
  }
  assert_eq!(
    failed(&fixture.draw(json!([])).await?),
    Some("Cannot draw a quantum emote: the overlay pool needs at least 2 emotes, found 1.")
  );
  assert_eq!(fixture.sampled()?, Vec::<Value>::new());
  assert_eq!(fixture.metric("too_few").as_deref(), Some("1"));
  Ok(())
}

#[tokio::test]
async fn explains_sidecar_failures_without_falling_back() -> Result<()> {
  let fixture = Fixture::new().await?;
  for (status, body, outcome) in [
    (
      503,
      json!({"detail": "rejection sampling budget exhausted"}),
      QuantumError::Exhausted,
    ),
    (401, json!({"detail":"unauthorized"}), QuantumError::Refused),
    (500, json!({}), QuantumError::Unavailable),
    (
      200,
      json!({"mode": "entangle", "qubits": 2, "base_index": 2, "overlay_index": 0}),
      QuantumError::Invalid,
    ),
  ] {
    fixture.answer(status, body)?;
    let reason = outcome.to_string();
    assert_eq!(
      failed(&fixture.draw(json!([])).await?),
      Some(reason.as_str())
    );
    assert_eq!(
      fixture.metric(outcome.label()).as_deref(),
      Some("1"),
      "{outcome:?}"
    );
  }
  assert_eq!(fixture.metric("sampled"), None);
  assert_eq!(fixture.sampled()?.len(), 4);
  Ok(())
}

#[tokio::test]
async fn reports_rejected_renders_and_unreadable_catalogs() -> Result<()> {
  let fixture = Fixture::new().await?;
  let busy = fixture
    .commands
    .application
    .reserve_render_fixture()
    .await?;
  let reason = fixture.draw(json!([])).await?;
  assert!(
    failed(&reason).is_some_and(|reason| reason.contains("rendering too many")),
    "{reason:?}"
  );
  drop(busy);
  fixture.store.invalidate_table("guild_emotes")?;
  std::assert_matches!(fixture.draw(json!([])).await, Err(_));
  Ok(())
}

#[tokio::test]
async fn edits_successes_and_sends_failures_ephemerally() -> Result<()> {
  let mut fixture = Fixture::new().await?;
  let http = crate::tests::http_for(&fixture.server);
  fixture
    .commands
    .respond(&http, interaction(&json!([]), 10_485_760)?)
    .await?;
  let (method, body) = fixture.discord.try_recv()?;
  assert_eq!(method, "edit");
  let text = String::from_utf8_lossy(&body);
  assert!(
    text.contains("Drew `Wave` with overlay `Glasses`"),
    "{text}"
  );
  assert!(body.windows(8).any(|bytes| bytes == b"\x89PNG\r\n\x1a\n"));

  for (options, limit, reason) in [
    (json!([]), 1, "exceeds Discord's upload limit"),
    (
      json!([{"name":"size","type":4,"value":9}]),
      10_485_760,
      "Choose size from 1 to 4.",
    ),
  ] {
    fixture
      .commands
      .respond(&http, interaction(&options, limit)?)
      .await?;
    let (method, body) = fixture.discord.try_recv()?;
    assert_eq!(method, "followup");
    assert_eq!(fixture.discord.try_recv()?.0, "delete");
    let followup: Value = serde_json::from_slice(&body)?;
    assert_eq!(followup.get("flags"), Some(&json!(64)), "{followup}");
    assert!(
      followup
        .get("content")
        .and_then(Value::as_str)
        .is_some_and(|content| content.contains(reason)),
      "{followup}"
    );
  }

  fixture.store.invalidate_table("guild_emotes")?;
  fixture
    .commands
    .respond(&http, interaction(&json!([]), 10_485_760)?)
    .await?;
  let followup: Value = serde_json::from_slice(&fixture.discord.try_recv()?.1)?;
  assert_eq!(fixture.discord.try_recv()?.0, "delete");
  assert_eq!(
    followup.get("content").and_then(Value::as_str),
    Some(FAILED)
  );
  Ok(())
}

#[tokio::test]
async fn ignores_the_command_without_a_configured_sidecar() -> Result<()> {
  let mut fixture = Fixture::new().await?;
  let unconfigured = Commands::new(Arc::clone(&fixture.commands.application), None);
  assert_eq!(unconfigured.names().collect::<Vec<_>>(), NAMES);
  assert_eq!(
    fixture.commands.names().last(),
    Some(NAME),
    "configured commands include quantum"
  );
  unconfigured
    .respond(
      &crate::tests::http_for(&fixture.server),
      interaction(&json!([]), 10_485_760)?,
    )
    .await?;
  std::assert_matches!(
    fixture.discord.try_recv(),
    Err(mpsc::error::TryRecvError::Empty)
  );
  assert_eq!(fixture.sampled()?, Vec::<Value>::new());
  Ok(())
}

#[tokio::test]
async fn reports_timeouts_and_failures_without_their_details() -> Result<()> {
  let logs = botge_test_support::TestLogs::default();
  let _logging = tracing::subscriber::set_default(logs.subscriber());
  let elapsed = || async {
    tokio::time::timeout(std::time::Duration::ZERO, std::future::pending::<()>())
      .await
      .err()
      .context("pending operation unexpectedly completed")
  };
  assert_eq!(failed(&settle(Err(elapsed().await?), 1)), Some(TIMED_OUT));
  let inner = anyhow::Error::new(elapsed().await?).context("render budget");
  assert_eq!(failed(&settle(Ok(Err(inner)), 1)), Some(TIMED_OUT));
  let other = anyhow::anyhow!("secret detail");
  assert_eq!(failed(&settle(Ok(Err(other)), 1)), Some(FAILED));
  let drawn = Draw::Drawn {
    bytes: vec![0; 2],
    filename: "emotes.png",
    caption: String::new(),
  };
  assert_eq!(failed(&settle(Ok(Ok(drawn)), 2)), None);
  assert!(logs.text()?.contains("quantum emote request failed"));
  Ok(())
}

#[tokio::test]
async fn propagates_render_failures_after_sampling() -> Result<()> {
  let fixture = Fixture::new().await?;
  fixture.store.invalidate_table("emote_borders")?;
  let client = fixture
    .commands
    .quantum
    .as_ref()
    .context("quantum client missing")?;
  let drawn = fixture
    .commands
    .draw(client, &[], Some(GUILD), Some(GUILD))
    .await;
  std::assert_matches!(drawn, Err(_));
  assert_eq!(fixture.metric("sampled").as_deref(), Some("1"));
  Ok(())
}

#[tokio::test]
async fn propagates_discord_failures_while_replying() -> Result<()> {
  let fixture = Fixture::new().await?;
  let denied = || async {
    (
      StatusCode::FORBIDDEN,
      Json(json!({"code": 50013, "message": "denied"})),
    )
  };
  let ok = || async { StatusCode::NO_CONTENT };
  let original = "/api/v10/webhooks/42/fixture/messages/@original";
  let callback = "/api/v10/interactions/9/fixture/callback";
  // Edit, followup and delete each fail in turn; a failed draw deletes only after its followup.
  for (stage, options) in [
    (0, json!([])),
    (1, json!([{"name":"size","type":4,"value":9}])),
    (2, json!([{"name":"size","type":4,"value":9}])),
  ] {
    let router = Router::new().route(callback, post(ok));
    let router = match stage {
      0 => router.route(original, patch(denied)),
      1 => router.route("/api/v10/webhooks/42/fixture", post(denied)),
      _ => router.route(original, delete(denied)).route(
        "/api/v10/webhooks/42/fixture",
        post(|| async { Json(serenity::all::Message::default()) }),
      ),
    };
    let discord = TestServer::start(router).await?;
    std::assert_matches!(
      fixture
        .commands
        .respond(
          &crate::tests::http_for(&discord),
          interaction(&options, 10_485_760)?
        )
        .await,
      Err(_),
      "stage {stage}"
    );
  }
  Ok(())
}

#[tokio::test]
async fn keeps_answering_other_commands_when_configured() -> Result<()> {
  let mut fixture = Fixture::new().await?;
  let mut shortcuts = serde_json::to_value(interaction(&json!([]), 10_485_760)?)?;
  *shortcuts
    .pointer_mut("/data/name")
    .context("missing command name")? = json!("emote-shortcuts");
  fixture
    .commands
    .respond(
      &crate::tests::http_for(&fixture.server),
      serde_json::from_value(shortcuts)?,
    )
    .await?;
  assert_eq!(fixture.discord.try_recv()?.0, "edit");
  assert_eq!(fixture.sampled()?, Vec::<Value>::new());
  Ok(())
}
