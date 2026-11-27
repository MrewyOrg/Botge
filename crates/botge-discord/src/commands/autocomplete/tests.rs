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
  store.add_emote(
    botge_storage::CatalogEditor::system(NonZeroU64::MIN),
    botge_test_support::example("Wave", "1"),
  )?;
  for (name, id) in [("Diene", "e26"), ("Dienophile", "e40"), ("Acetic", "e8")] {
    store.add_emote(
      botge_storage::CatalogEditor::system(NonZeroU64::MIN),
      botge_test_support::example(name, id),
    )?;
  }
  let mut emotes = Application::new(
    botge_domain::providers::Providers {
      seven_added: true,
      seven_global: true,
      ..Default::default()
    },
    store,
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
        "/v3/emote-sets/global",
        get(|| async { Json(json!({"emotes":[{"name":"GlobalWave","flags":0,"data":botge_test_support::seven_example("GlobalWave", false, 0)}]})) }),
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
    ("react-emote", "reactant_a", 3, "Wa", json!("Wave")),
    ("react-emote", "reactant_b", 3, "Glo", json!("GlobalWave")),
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
async fn filters_chemistry_autocomplete_mutually_by_partner_and_condition() -> Result<()> {
  use axum::{Json, Router, http::StatusCode, routing::post};
  use tokio::sync::mpsc;

  let dir = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(&dir.path().join("botge.redb"))?);
  for (name, id) in [("Diene", "e26"), ("Dienophile", "e40"), ("Acetic", "e8")] {
    store.add_emote(
      botge_storage::CatalogEditor::system(NonZeroU64::MIN),
      botge_test_support::example(name, id),
    )?;
  }
  let emotes = Application::new(
    botge_domain::providers::Providers {
      seven_added: true,
      ..Default::default()
    },
    store,
  )?;
  let (sender, mut choices) = mpsc::unbounded_channel();
  let server = crate::tests::TestServer::start(Router::new().route(
    "/api/v10/interactions/9/fixture/callback",
    post(move |Json(body): Json<Value>| async move {
      drop(sender.send(body));
      StatusCode::NO_CONTENT
    }),
  ))
  .await?;
  let commands = Commands::new(Arc::new(emotes), None);
  let http = crate::tests::http_for(&server);

  for (options, expected_values) in [
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Diene", "focused": false},
        {"name": "reactant_b", "type": 3, "value": "", "focused": true}
      ]),
      vec!["Dienophile"],
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "", "focused": true},
        {"name": "reactant_b", "type": 3, "value": "Dienophile", "focused": false}
      ]),
      vec!["Diene"],
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Diene", "focused": false},
        {"name": "reactant_b", "type": 3, "value": "", "focused": true},
        {"name": "condition", "type": 3, "value": "acid", "focused": false}
      ]),
      Vec::<&str>::new(),
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "UnknownEmote", "focused": false},
        {"name": "reactant_b", "type": 3, "value": "Dien", "focused": true}
      ]),
      vec!["Diene", "Dienophile"],
    ),
  ] {
    let interaction = serde_json::from_value(json!({
      "id":"9", "application_id":"42", "guild_id":"1", "channel_id":"2",
      "token":"fixture", "version":1, "locale":"en-US", "entitlements":[],
      "attachment_size_limit":10_485_760,
      "data":{"id":"7","type":1,"name":"react-emote","options":options}
    }))?;
    commands.autocomplete(&http, interaction).await?;
    let response = choices.try_recv()?;
    let actual: Vec<&str> = response
      .pointer("/data/choices")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(|choice| choice.get("value").and_then(Value::as_str))
      .collect();
    assert_eq!(actual, expected_values);
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
    .autocomplete(&http, interaction("react-emote", true)?)
    .await?;
  commands
    .autocomplete(&http, interaction("unknown", true)?)
    .await?;
  let mut chem_reactant_a = serde_json::to_value(interaction("react-emote", true)?)?;
  if let Some(opt) = chem_reactant_a.pointer_mut("/data/options/0/name") {
    *opt = json!("reactant_a");
  }
  commands
    .autocomplete(&http, serde_json::from_value(chem_reactant_a)?)
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

#[test]
fn chemistry_suggestions_include_substrate_and_respect_limit() -> Result<()> {
  let long_name = "x".repeat(95);
  let entries = [
    botge_test_support::example("", "id-empty"),
    botge_test_support::example(&"z".repeat(101), "id-too-long"),
    botge_test_support::example("SeaWave", "id-seawave"),
    botge_test_support::example("Waves", "id-waves"),
    botge_test_support::example("Wave", "id-wave"),
    botge_test_support::example("wave", "id-wave-dup"),
    botge_test_support::example(&long_name, "id-long"),
    botge_test_support::example("Diene", "e26"),
    botge_test_support::example("Dienophile", "e40"),
    botge_test_support::example("Acetic", "e8"),
  ];
  let catalog = botge_app::Catalog::new(entries.to_vec(), vec![]);
  let choices = chemistry_suggestions(&catalog, "wave", None, Condition::Auto);
  assert_eq!(choices.len(), 3);
  let first = choices
    .first()
    .ok_or_else(|| anyhow::anyhow!("first choice"))?;
  assert_eq!(first.1, "Wave");
  assert!(first.0.starts_with("Wave — "));
  assert!(first.0.contains(substrate_index("id-wave").info().name));

  let prefix_choices = chemistry_suggestions(&catalog, "wav", None, Condition::Auto);
  assert_eq!(
    prefix_choices
      .iter()
      .map(|(_, value)| value.as_str())
      .collect::<Vec<_>>(),
    vec!["Waves", "Wave", "SeaWave"]
  );

  assert_eq!(
    chemistry_suggestions(&catalog, "nomatch", None, Condition::Auto),
    Vec::new()
  );

  let long_choices = chemistry_suggestions(&catalog, "xxx", None, Condition::Auto);
  let first_long = long_choices
    .first()
    .ok_or_else(|| anyhow::anyhow!("long choice"))?;
  assert_eq!(long_choices.len(), 1);
  assert!(first_long.0.chars().count() <= 100);
  assert_eq!(first_long.1, long_name);

  let diene = substrate_index("e26");
  let auto_partners: Vec<_> = chemistry_suggestions(&catalog, "", Some(diene), Condition::Auto)
    .into_iter()
    .map(|(_, value)| value)
    .collect();
  assert!(auto_partners.contains(&"Dienophile".to_owned()));
  assert!(!auto_partners.contains(&"Acetic".to_owned()));
  assert!(!auto_partners.contains(&"Diene".to_owned()));
  let heat_partners: Vec<_> = chemistry_suggestions(&catalog, "d", Some(diene), Condition::Heat)
    .into_iter()
    .map(|(_, value)| value)
    .collect();
  assert_eq!(heat_partners, vec!["Dienophile"]);
  assert_eq!(
    chemistry_suggestions(&catalog, "Dienophile", Some(diene), Condition::Acid),
    Vec::new()
  );
  assert_eq!(
    chemistry_suggestions(&catalog, "", None, Condition::Heat)
      .into_iter()
      .map(|(_, value)| value)
      .collect::<Vec<_>>()
      .into_iter()
      .filter(|n| matches!(n.as_str(), "Diene" | "Dienophile" | "Acetic"))
      .collect::<Vec<_>>(),
    vec!["Diene", "Dienophile"]
  );
  Ok(())
}

#[test]
fn condition_suggestions_filter_by_selected_reactants_and_catalog() {
  let entries = [
    botge_test_support::example("Diene", "e26"),
    botge_test_support::example("Dienophile", "e40"),
    botge_test_support::example("Acetic", "e8"),
  ];
  let catalog = botge_app::Catalog::new(entries.to_vec(), vec![]);
  let diene = substrate_index("e26");
  let dienophile = substrate_index("e40");
  let acetic = substrate_index("e8");

  let all: Vec<_> = condition_suggestions(None, "", None, None)
    .into_iter()
    .map(|(_, v)| v)
    .collect();
  assert_eq!(all, vec!["auto", "heat", "acid", "base", "palladium"]);
  assert_eq!(
    condition_suggestions(None, "suzuki", None, None)
      .into_iter()
      .map(|(_, v)| v)
      .collect::<Vec<_>>(),
    vec!["palladium"]
  );

  let from_a: Vec<_> = condition_suggestions(Some(&catalog), "", Some(diene), None)
    .into_iter()
    .map(|(_, v)| v)
    .collect();
  assert_eq!(from_a, vec!["auto", "heat"]);

  let from_b: Vec<_> = condition_suggestions(Some(&catalog), "", None, Some(dienophile))
    .into_iter()
    .map(|(_, v)| v)
    .collect();
  assert_eq!(from_b, vec!["auto", "heat"]);

  let both_ok: Vec<_> = condition_suggestions(Some(&catalog), "", Some(diene), Some(dienophile))
    .into_iter()
    .map(|(_, v)| v)
    .collect();
  assert_eq!(both_ok, vec!["auto", "heat"]);

  assert_eq!(
    condition_suggestions(Some(&catalog), "", Some(diene), Some(acetic)),
    Vec::new()
  );

  // Catalog lacking any partner for `diene` offers no conditions, while `None` catalog falls back
  // to intrinsic atlas reactivity.
  let no_partner_catalog = botge_app::Catalog::new(
    vec![
      botge_test_support::example("Diene", "e26"),
      botge_test_support::example("Acetic", "e8"),
    ],
    vec![],
  );
  assert_eq!(
    condition_suggestions(Some(&no_partner_catalog), "", Some(diene), None),
    Vec::new()
  );
  let intrinsic: Vec<_> = condition_suggestions(None, "", Some(diene), None)
    .into_iter()
    .map(|(_, v)| v)
    .collect();
  assert_eq!(intrinsic, vec!["auto", "heat"]);
}

#[tokio::test]
async fn completes_condition_option_from_selected_reactants() -> Result<()> {
  use axum::{Json, Router, http::StatusCode, routing::post};
  use tokio::sync::mpsc;

  let dir = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(&dir.path().join("botge.redb"))?);
  for (name, id) in [("Diene", "e26"), ("Dienophile", "e40"), ("Acetic", "e8")] {
    store.add_emote(
      botge_storage::CatalogEditor::system(NonZeroU64::MIN),
      botge_test_support::example(name, id),
    )?;
  }
  let emotes = Application::new(
    botge_domain::providers::Providers {
      seven_added: true,
      ..Default::default()
    },
    store,
  )?;
  let (sender, mut choices) = mpsc::unbounded_channel();
  let server = crate::tests::TestServer::start(Router::new().route(
    "/api/v10/interactions/9/fixture/callback",
    post(move |Json(body): Json<Value>| async move {
      drop(sender.send(body));
      StatusCode::NO_CONTENT
    }),
  ))
  .await?;
  let commands = Commands::new(Arc::new(emotes), None);
  let http = crate::tests::http_for(&server);

  for (options, expected_values) in [
    (
      json!([{"name": "condition", "type": 3, "value": "", "focused": true}]),
      vec!["auto", "heat", "acid", "base", "palladium"],
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Diene", "focused": false},
        {"name": "condition", "type": 3, "value": "", "focused": true}
      ]),
      vec!["auto", "heat"],
    ),
    (
      json!([
        {"name": "reactant_b", "type": 3, "value": "Dienophile", "focused": false},
        {"name": "condition", "type": 3, "value": "", "focused": true}
      ]),
      vec!["auto", "heat"],
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Diene", "focused": false},
        {"name": "reactant_b", "type": 3, "value": "Dienophile", "focused": false},
        {"name": "condition", "type": 3, "value": "", "focused": true}
      ]),
      vec!["auto", "heat"],
    ),
    (
      json!([
        {"name": "reactant_a", "type": 3, "value": "Diene", "focused": false},
        {"name": "reactant_b", "type": 3, "value": "Acetic", "focused": false},
        {"name": "condition", "type": 3, "value": "", "focused": true}
      ]),
      Vec::<&str>::new(),
    ),
  ] {
    let interaction = serde_json::from_value(json!({
      "id":"9", "application_id":"42", "guild_id":"1", "channel_id":"2",
      "token":"fixture", "version":1, "locale":"en-US", "entitlements":[],
      "attachment_size_limit":10_485_760,
      "data":{"id":"7","type":1,"name":"react-emote","options":options}
    }))?;
    commands.autocomplete(&http, interaction).await?;
    let response = choices.try_recv()?;
    let actual: Vec<&str> = response
      .pointer("/data/choices")
      .and_then(Value::as_array)
      .into_iter()
      .flatten()
      .filter_map(|choice| choice.get("value").and_then(Value::as_str))
      .collect();
    assert_eq!(actual, expected_values);
  }
  Ok(())
}
