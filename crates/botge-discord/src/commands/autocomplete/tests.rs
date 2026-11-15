//! Exercises autocomplete command behavior.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::sync::Arc;

use botge_app::Application;
use serde_json::{Value, json};

use super::super::shortcuts::shortcuts;
use super::*;

/// Adapts fixture slices to the same immutable catalog view used by requests.
fn suggestions(emotes: &[botge_domain::emotes::Emote], value: &str) -> Vec<String> {
  super::suggestions(&botge_app::Catalog::new(emotes.to_vec(), vec![]), value)
}

#[bench]
fn autocomplete_catalog(b: &mut test::Bencher) {
  let entries: Vec<_> = (0..1000)
    .map(|id| botge_test_support::example(&format!("Wave{id}"), &id.to_string()))
    .collect();
  let catalog = botge_app::Catalog::new(entries, vec![]);
  b.iter(|| std::hint::black_box(super::suggestions(std::hint::black_box(&catalog), "wav")));
}

#[test]
fn suggests_unique_names_ranked_by_match_and_keeps_existing_tokens() {
  let entries = ["SeaWave", "Waves", "Wave", "wave", "A Wave", "Hey"]
    .map(|name| botge_test_support::example(name, name));
  assert_eq!(
    suggestions(&entries, "wAvE"),
    ["Wave", "Waves", "SeaWave", "A Wave"]
  );
  assert_eq!(
    suggestions(&entries, "Hey wavE"),
    ["Hey Wave", "Hey Waves", "Hey SeaWave"]
  );
  assert_eq!(suggestions(&entries, "other"), Vec::<String>::new());
  assert_eq!(
    suggestions(&entries, &format!("{} ", "x".repeat(100))),
    Vec::<String>::new()
  );
  let invalid = [
    botge_test_support::example("", "empty"),
    botge_test_support::example(&"x".repeat(101), "long"),
  ];
  assert_eq!(suggestions(&invalid, ""), Vec::<String>::new());
  assert!(shortcuts(&entries, "Waves").contains("`Waves` → `es`"));
  assert!(shortcuts(&entries, "A Wave").starts_with("`A Wave`"));
  assert!(shortcuts(&entries, "other").starts_with("No unique"));
}

#[tokio::test]
async fn sends_name_and_size_choices_to_discord() -> Result<()> {
  use axum::{
    Json, Router,
    http::StatusCode,
    routing::{get, post},
  };
  use tokio::sync::mpsc;

  let dir = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(&dir.path().join("botge.redb"))?);
  store.add_emote(NonZeroU64::MIN, botge_test_support::example("Wave", "1"))?;
  let mut emotes = Application::new(
    botge_domain::providers::Providers {
      seven_added: true,
      bttv: true,
      ..Default::default()
    },
    store,
    None,
  )?;
  let (sender, mut choices) = mpsc::unbounded_channel();
  let server = crate::tests::TestServer::start(
    Router::new()
      .route(
        "/api/v10/interactions/9/fixture/callback",
        post(move |Json(body): Json<Value>| async move {
          drop(sender.send(body));
          StatusCode::NO_CONTENT
        }),
      )
      .route(
        "/3/cached/emotes/global",
        get(|| async { Json(json!([{"id":"valid","code":"GlobalWave","animated":false}])) }),
      ),
  )
  .await?;
  emotes.use_provider_fixture(server.origin.clone());
  let commands = Commands::new(Arc::new(emotes), None);
  let http = crate::tests::http_for(&server);
  for (name, field, kind, value, expected) in [
    ("emote-compose", "emotes", 3, "Wa", json!("Wave")),
    ("emote-compose", "size", 4, "3", json!(3)),
    (
      "emote-compose",
      "emotes",
      3,
      "First Wa",
      json!("First Wave"),
    ),
    ("emote-shortcuts", "emotes", 3, "Wa", json!("Wave")),
    (
      "emote-shortcuts",
      "emotes",
      3,
      "Global",
      json!("GlobalWave"),
    ),
    ("emote-compose", "emotes", 3, "Global", json!("GlobalWave")),
  ] {
    let interaction = serde_json::from_value(json!({
        "id":"9", "application_id":"42", "guild_id":"1", "channel_id":"2",
        "token":"fixture", "version":1, "locale":"en-US", "entitlements":[],
        "attachment_size_limit":10_485_760,
        "data":{"id":"7","type":1,"name":name,"options":[
            {"name":field,"type":kind,"value":value,"focused":true}
        ]}
    }))?;
    commands.autocomplete(&http, interaction).await?;
    let response = choices.try_recv()?;
    assert_eq!(response.get("type"), Some(&json!(8)));
    assert_eq!(response.pointer("/data/choices/0/value"), Some(&expected));
  }
  Ok(())
}

#[tokio::test]
async fn returns_empty_choices_for_unavailable_catalogs_and_propagates_callback_errors()
-> Result<()> {
  use axum::{Json, Router, http::StatusCode, routing::post};
  let directory = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  store.invalidate_table("guild_emotes")?;
  let commands = Commands::new(
    Arc::new(Application::new(
      botge_domain::providers::Providers::default(),
      store,
      None,
    )?),
    None,
  );
  let server = botge_test_support::TestServer::start(Router::new().route(
    "/api/v10/interactions/9/fixture/callback",
    post(|Json(body): Json<Value>| async move {
      assert_eq!(body.pointer("/data/choices"), Some(&json!([])));
      StatusCode::NO_CONTENT
    }),
  ))
  .await?;
  let interaction = |name, focused| -> Result<CommandInteraction> {
    Ok(serde_json::from_value(json!({
      "id":"9", "application_id":"42", "guild_id":"1", "channel_id":"2",
      "token":"fixture", "version":1, "locale":"en-US", "entitlements":[], "attachment_size_limit":10_485_760,
      "data":{"id":"7","type":1,"name":name,"options":[{"name":"emotes","type":3,"value":"Wave","focused":focused}]}
    }))?)
  };
  let http = botge_test_support::http_for(&server);
  commands
    .autocomplete(&http, interaction("emote-compose", true)?)
    .await?;
  commands
    .autocomplete(&http, interaction("unknown", true)?)
    .await?;
  commands
    .autocomplete(&http, interaction("emote-compose", false)?)
    .await?;
  let unavailable = botge_test_support::TestServer::start(Router::new()).await?;
  std::assert_matches!(
    commands
      .autocomplete(
        &botge_test_support::http_for(&unavailable),
        interaction("emote-compose", true)?
      )
      .await,
    Err(_)
  );
  Ok(())
}
