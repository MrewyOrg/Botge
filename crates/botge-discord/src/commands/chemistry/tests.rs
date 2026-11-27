//! Exercises `/react-emote` against loopback sidecar, media, and Discord fixtures.

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
use botge_test_support::{TestServer, example, http_for};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::*;

const SAMPLE_PNG_B64: &str =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

struct Fixture {
  _directory: tempfile::TempDir,
  store: Arc<crate::storage::Store>,
  commands: Commands,
  server: TestServer,
  answer: Arc<Mutex<(u16, Value)>>,
  reply_status: Arc<Mutex<u16>>,
  recorded: Arc<Mutex<Vec<Value>>>,
  discord: mpsc::UnboundedReceiver<(&'static str, Bytes)>,
}

const GUILD: NonZeroU64 = NonZeroU64::MIN;

fn default_answer() -> Value {
  json!({
    "outcome": "reacted",
    "reaction_id": "diels_alder",
    "reaction_name": "Diels-Alder [4+2] cycloaddition",
    "condition_used": "heat",
    "substrate_a_name": "1,3-butadiene",
    "substrate_b_name": "maleic anhydride",
    "product_smiles": "O=C1OC(=O)C2CC=CCC12",
    "product_formula": "C8H8O3",
    "product_mw": 152.15,
    "inchi_key": "KEY123",
    "base_index": 2,
    "overlay_index": 0,
    "diagram_png_b64": SAMPLE_PNG_B64
  })
}

fn interaction(options: &Value, limit: usize) -> Result<CommandInteraction> {
  Ok(serde_json::from_value(json!({
    "id": "9",
    "application_id": "42",
    "guild_id": GUILD.get().to_string(),
    "channel_id": "10",
    "token": "fixture",
    "version": 1,
    "locale": "en-US",
    "entitlements": [],
    "attachment_size_limit": limit,
    "user": crate::tests::user("7"),
    "data": {
      "id": "1",
      "name": NAME,
      "type": 1,
      "options": options
    }
  }))?)
}

fn fixture_router(
  pixel: Vec<u8>,
  answer: Arc<Mutex<(u16, Value)>>,
  recorded: Arc<Mutex<Vec<Value>>>,
  reply_status: Arc<Mutex<u16>>,
  calls: mpsc::UnboundedSender<(&'static str, Bytes)>,
) -> Router {
  let (edits, deletes, replies) = (calls.clone(), calls.clone(), calls.clone());
  Router::new()
    .route(
      "/v1/react",
      post(move |Json(body): Json<Value>| {
        let (reply, log) = (Arc::clone(&answer), Arc::clone(&recorded));
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
        let mut message = serenity::all::Message::default();
        message.id = serenity::all::MessageId::new(77);
        message.channel_id = serenity::all::ChannelId::new(10);
        Json(message)
      })
      .merge(delete(move || async move {
        drop(deletes.send(("delete", Bytes::new())));
        StatusCode::NO_CONTENT
      })),
    )
    .route(
      "/api/v10/channels/10/messages",
      post(move |body: Bytes| {
        let (replies, reply_code) = (replies.clone(), Arc::clone(&reply_status));
        async move {
          let status = reply_code.lock().map_or(500, |code| *code);
          if status == 200 {
            drop(replies.send(("reply", body)));
            (
              StatusCode::OK,
              Json(serde_json::to_value(serenity::all::Message::default()).unwrap_or(Value::Null)),
            )
          } else {
            (
              StatusCode::from_u16(status).unwrap_or(StatusCode::FORBIDDEN),
              Json(json!({"code": 50013, "message": "Missing Permissions"})),
            )
          }
        }
      }),
    )
    .route(
      "/api/v10/webhooks/42/fixture",
      post(move |body: Bytes| async move {
        drop(calls.send(("followup", body)));
        Json(serenity::all::Message::default())
      }),
    )
}

impl Fixture {
  async fn new() -> Result<Self> {
    let pixel = crate::tests::png_pixel()?;
    let answer = Arc::new(Mutex::new((200, default_answer())));
    let reply_status = Arc::new(Mutex::new(200));
    let recorded = Arc::new(Mutex::new(Vec::new()));
    let (calls, discord) = mpsc::unbounded_channel();
    let server = TestServer::start(fixture_router(
      pixel,
      Arc::clone(&answer),
      Arc::clone(&recorded),
      Arc::clone(&reply_status),
      calls,
    ))
    .await?;
    let directory = tempfile::tempdir()?;
    let store = Arc::new(crate::storage::Store::open(
      &directory.path().join("botge.redb"),
    )?);
    for (name, emote_id, overlaying) in [
      ("Alpha", "1", false),
      ("Beta", "2", false),
      ("Gamma", "3", false),
      ("Hat", "4", true),
      ("Glasses", "5", true),
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
      .with_chemistry(ChemistryClient::new(&server.origin, None)?);
    Ok(Self {
      _directory: directory,
      store,
      commands,
      server,
      answer,
      reply_status,
      recorded,
      discord,
    })
  }

  fn reply_status(&self, status: u16) -> Result<()> {
    *self
      .reply_status
      .lock()
      .map_err(|_error| anyhow::anyhow!("poisoned"))? = status;
    Ok(())
  }

  fn answer(&self, status: u16, body: Value) -> Result<()> {
    *self
      .answer
      .lock()
      .map_err(|_error| anyhow::anyhow!("poisoned"))? = (status, body);
    Ok(())
  }

  async fn react(&self, options: Value) -> Result<Reaction> {
    let client = self
      .commands
      .chemistry
      .as_ref()
      .context("chemistry client missing")?;
    let options: Vec<CommandDataOption> = serde_json::from_value(options)?;
    self
      .commands
      .react(client, &options, Some(GUILD), NonZeroU64::new(7))
      .await
  }
}

#[tokio::test]
async fn reacts_two_emotes_and_edits_discord_with_or_without_diagram() -> Result<()> {
  let mut fixture = Fixture::new().await?;
  let http = http_for(&fixture.server);

  fixture
    .commands
    .respond(
      &http,
      interaction(
        &json!([
          {"name": "reactant_a", "type": 3, "value": "Alpha"},
          {"name": "reactant_b", "type": 3, "value": "Beta"},
          {"name": "condition", "type": 3, "value": "heat"},
          {"name": "size", "type": 4, "value": 2}
        ]),
        10_485_760,
      )?,
    )
    .await?;
  let edit_with_diagram = fixture.discord.recv().await.context("missing edit")?;
  assert_eq!(edit_with_diagram.0, "edit");
  let payload_with_diagram = String::from_utf8_lossy(&edit_with_diagram.1);
  assert!(!payload_with_diagram.contains("reaction.png"));
  assert!(payload_with_diagram.contains("`Alpha` (1,3-butadiene)"));
  assert!(payload_with_diagram.contains("`Gamma` + `Glasses`"));

  let reply_with_diagram = fixture.discord.recv().await.context("missing reply")?;
  assert_eq!(reply_with_diagram.0, "reply");
  let reply_payload = String::from_utf8_lossy(&reply_with_diagram.1);
  assert!(reply_payload.contains("reaction.png"));
  assert!(reply_payload.contains("\"message_id\":\"77\""));
  assert!(reply_payload.contains("\"replied_user\":false"));

  let mut plain_answer = default_answer();
  if let Some(obj) = plain_answer.as_object_mut() {
    obj.insert("diagram_png_b64".into(), Value::Null);
  }
  fixture.answer(200, plain_answer)?;
  fixture
    .commands
    .respond(
      &http,
      interaction(
        &json!([
          {"name": "reactant_a", "type": 3, "value": "Alpha"},
          {"name": "reactant_b", "type": 3, "value": "Beta"},
          {"name": "diagram", "type": 5, "value": false}
        ]),
        10_485_760,
      )?,
    )
    .await?;
  let edit_without_diagram = fixture.discord.recv().await.context("missing plain edit")?;
  assert_eq!(edit_without_diagram.0, "edit");
  let payload_without_diagram = String::from_utf8_lossy(&edit_without_diagram.1);
  assert!(!payload_without_diagram.contains("reaction.png"));
  std::assert_matches!(
    fixture.discord.try_recv(),
    Err(mpsc::error::TryRecvError::Empty)
  );

  let recorded = fixture
    .recorded
    .lock()
    .map_or_else(|poison| poison.into_inner().clone(), |guard| guard.clone());
  assert_eq!(recorded.len(), 2);
  assert_eq!(
    recorded
      .first()
      .and_then(|body| body.get("exclude_base_indices")),
    Some(&json!([0, 1]))
  );
  Ok(())
}

#[tokio::test]
async fn diagram_reply_falls_back_to_followup_and_propagates_http_errors() -> Result<()> {
  let mut fixture = Fixture::new().await?;
  let http = http_for(&fixture.server);

  fixture.reply_status(403)?;
  fixture
    .commands
    .respond(
      &http,
      interaction(
        &json!([
          {"name": "reactant_a", "type": 3, "value": "Alpha"},
          {"name": "reactant_b", "type": 3, "value": "Beta"}
        ]),
        10_485_760,
      )?,
    )
    .await?;
  let fallback_edit = fixture
    .discord
    .recv()
    .await
    .context("missing fallback edit")?;
  assert_eq!(fallback_edit.0, "edit");
  assert!(!String::from_utf8_lossy(&fallback_edit.1).contains("reaction.png"));
  let fallback_followup = fixture
    .discord
    .recv()
    .await
    .context("missing fallback followup")?;
  assert_eq!(fallback_followup.0, "followup");
  assert!(String::from_utf8_lossy(&fallback_followup.1).contains("reaction.png"));

  let unmatched = TestServer::start(Router::new()).await?;
  let client = fixture
    .commands
    .chemistry
    .as_ref()
    .context("chemistry client missing")?;
  std::assert_matches!(
    fixture
      .commands
      .respond_chemistry(
        &http_for(&unmatched),
        &interaction(
          &json!([
            {"name": "reactant_a", "type": 3, "value": "Alpha"},
            {"name": "reactant_b", "type": 3, "value": "Beta"}
          ]),
          10_485_760,
        )?,
        client,
      )
      .await,
    Err(_)
  );
  Ok(())
}

#[tokio::test]
async fn no_reaction_and_failures_send_ephemeral_followup_and_delete_deferred() -> Result<()> {
  let mut fixture = Fixture::new().await?;
  fixture.answer(
    200,
    json!({
      "outcome": "no_reaction",
      "substrate_a_name": "1,3-butadiene",
      "substrate_a_group": "conjugated diene",
      "substrate_b_name": "maleic anhydride",
      "substrate_b_group": "cyclic dienophile",
      "reason": "Incompatible under acid.",
      "hint_condition": "heat",
      "hint_reaction": "Diels-Alder"
    }),
  )?;
  let http = http_for(&fixture.server);
  fixture
    .commands
    .respond(
      &http,
      interaction(
        &json!([
          {"name": "reactant_a", "type": 3, "value": "Alpha"},
          {"name": "reactant_b", "type": 3, "value": "Beta"},
          {"name": "condition", "type": 3, "value": "acid"}
        ]),
        10_485_760,
      )?,
    )
    .await?;
  let first = fixture.discord.recv().await.context("missing delete")?;
  let second = fixture.discord.recv().await.context("missing followup")?;
  assert_eq!(first.0, "delete");
  assert_eq!(second.0, "followup");
  assert!(String::from_utf8_lossy(&second.1).contains("\"flags\":64"));
  let metrics = fixture.commands.application.render_metrics();
  assert!(metrics.contains("botge_chemistry_reactions_total{outcome=\"no_reaction\"} 1"));
  Ok(())
}

#[tokio::test]
async fn validates_options_catalogs_sidecar_errors_and_render_limits() -> Result<()> {
  let fixture = Fixture::new().await?;

  for (options, expected) in [
    (json!([]), "Choose two emotes"),
    (
      json!([{"name": "reactant_a", "type": 3, "value": "Alpha"}]),
      "Choose two emotes",
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Alpha"},
        {"name": "reactant_b", "type": 3, "value": "Beta"},
        {"name": "condition", "type": 3, "value": "plasma"}
      ]),
      "Choose `condition` from",
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "UnknownEmote"},
        {"name": "reactant_b", "type": 3, "value": "Beta"}
      ]),
      "UnknownEmote",
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Alpha"},
        {"name": "reactant_b", "type": 3, "value": "UnknownB"}
      ]),
      "UnknownB",
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Alpha"},
        {"name": "reactant_b", "type": 3, "value": "Beta"},
        {"name": "size", "type": 4, "value": 9}
      ]),
      "1 to 4",
    ),
  ] {
    let outcome = fixture.react(options).await?;
    assert!(
      matches!(&outcome, Reaction::Failed(msg) if msg.contains(expected)),
      "expected {expected} in {outcome:?}"
    );
  }

  for (status, body, expected_metric) in [
    (401, json!({}), ChemError::Refused),
    (503, json!({}), ChemError::Unavailable),
    (200, json!({"bad": "shape"}), ChemError::Invalid),
  ] {
    fixture.answer(status, body)?;
    let res = fixture
      .react(json!([
        {"name": "reactant_a", "type": 3, "value": "Alpha"},
        {"name": "reactant_b", "type": 3, "value": "Beta"}
      ]))
      .await?;
    assert_eq!(res_reason(&res), Some(expected_metric.to_string().as_str()));
  }
  assert_eq!(outcome_metric(ChemError::Busy), ChemistryOutcome::Busy);

  // Answer::Text when compose slots are saturated.
  fixture.answer(200, default_answer())?;
  let busy_render = fixture
    .commands
    .application
    .reserve_render_fixture()
    .await?;
  let busy_res = fixture
    .react(json!([
      {"name": "reactant_a", "type": 3, "value": "Alpha"},
      {"name": "reactant_b", "type": 3, "value": "Beta"}
    ]))
    .await?;
  assert!(matches!(busy_res, Reaction::Failed(msg) if msg.contains("rendering too many")));
  drop(busy_render);

  // TooFew overlays triggers ChemistryOutcome::TooFew.
  for name in ["Hat", "Glasses"] {
    let mut list = fixture.store.added_emotes(GUILD)?;
    list.retain(|emote| emote.name == name);
    for emote in list {
      fixture
        .store
        .remove_emote(botge_storage::CatalogEditor::system(GUILD), &emote.id)?;
    }
  }
  let too_few = fixture
    .react(json!([
      {"name": "reactant_a", "type": 3, "value": "Alpha"},
      {"name": "reactant_b", "type": 3, "value": "Beta"}
    ]))
    .await?;
  assert!(matches!(too_few, Reaction::Failed(msg) if msg.contains("overlay pool")));
  assert!(
    fixture
      .commands
      .application
      .render_metrics()
      .contains("botge_chemistry_reactions_total{outcome=\"too_few\"} 1")
  );
  Ok(())
}

#[tokio::test]
async fn settle_handles_limits_and_timeouts() -> Result<()> {
  let ok_plain = Reaction::Reacted {
    bytes: vec![0; 50],
    filename: "emote.png",
    diagram_png: None,
    caption: "cap".into(),
  };
  assert!(matches!(
    settle(Ok(Ok(ok_plain)), 50),
    Reaction::Reacted { .. }
  ));

  let ok_split = Reaction::Reacted {
    bytes: vec![0; 80],
    filename: "emote.png",
    diagram_png: Some(vec![0; 80]),
    caption: "cap".into(),
  };
  assert!(matches!(
    settle(Ok(Ok(ok_split)), 100),
    Reaction::Reacted { .. }
  ));

  let over_emote = settle(
    Ok(Ok(Reaction::Reacted {
      bytes: vec![0; 121],
      filename: "emote.png",
      diagram_png: Some(vec![0; 50]),
      caption: "cap".into(),
    })),
    120,
  );
  assert!(matches!(over_emote, Reaction::Failed(msg) if msg.contains("upload limit")));

  let over_diagram = settle(
    Ok(Ok(Reaction::Reacted {
      bytes: vec![0; 50],
      filename: "emote.png",
      diagram_png: Some(vec![0; 121]),
      caption: "cap".into(),
    })),
    120,
  );
  assert!(matches!(over_diagram, Reaction::Failed(msg) if msg.contains("upload limit")));

  let elapsed = tokio::time::timeout(std::time::Duration::ZERO, std::future::pending::<()>())
    .await
    .err()
    .context("pending future completed")?;
  assert_eq!(res_reason(&settle(Err(elapsed), 100)), Some(TIMED_OUT));

  let elapsed2 = tokio::time::timeout(std::time::Duration::ZERO, std::future::pending::<()>())
    .await
    .err()
    .context("pending future completed")?;
  assert_eq!(
    res_reason(&settle(Ok(Err(anyhow::Error::new(elapsed2))), 100)),
    Some(TIMED_OUT)
  );

  assert_eq!(
    res_reason(&settle(Ok(Err(anyhow::anyhow!("boom"))), 100)),
    Some(FAILED)
  );
  Ok(())
}

fn res_reason(reaction: &Reaction) -> Option<&str> {
  match reaction {
    Reaction::Failed(reason) => Some(reason.as_str()),
    Reaction::Reacted { .. } => None,
  }
}
