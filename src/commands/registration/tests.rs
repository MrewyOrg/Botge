//! Exercises registration command behavior.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]
#![allow(
  clippy::let_underscore_must_use,
  reason = "Fixture receivers may close during teardown"
)]

use super::*;
use serde_json::{Value, json};

#[test]
fn exposes_registered_commands_and_clear_permissions() -> Result<()> {
  let commands = serde_json::to_value(definitions())?;
  for (index, expected) in NAMES.into_iter().enumerate() {
    assert_eq!(
      commands
        .pointer(&format!("/{index}/name"))
        .and_then(Value::as_str),
      Some(expected)
    );
  }
  assert_eq!(commands.as_array().map(Vec::len), Some(3));
  assert_eq!(commands.pointer("/2/integration_types"), Some(&json!([0])));
  assert_eq!(commands.pointer("/2/contexts"), Some(&json!([0])));
  assert_eq!(
    commands.pointer("/2/default_member_permissions"),
    Some(&json!("8"))
  );
  assert_eq!(
    commands.pointer("/0/options/0/required"),
    Some(&Value::Bool(true))
  );
  Ok(())
}

#[tokio::test]
async fn registers_emote_commands_and_removes_retired_commands_while_preserving_launch()
-> Result<()> {
  use axum::{
    Json, Router,
    extract::Path,
    http::StatusCode,
    routing::{delete, get},
  };
  use tokio::sync::mpsc;
  let (deleted, mut removals) = mpsc::unbounded_channel();
  let command = |id: &str, name: &str, kind: u8| {
    json!({
        "id":id,"application_id":"42","type":kind,"name":name,"description":"Fixture","version":"1"
    })
  };
  let legacy = json!([
    command("11", "settings", 1),
    command("12", "launch", 4),
    command("13", "emote", 1),
    command("14", "emote-search", 1),
    command("15", "emote-compose", 1)
  ]);
  let server = crate::tests::TestServer::start(
    Router::new()
      .route(
        "/api/v10/applications/42/commands",
        get(move || async move { Json(legacy) }).post(|Json(body): Json<Value>| async move {
          Json(json!({
              "id":"14","application_id":"42","type":1,
              "name":body.get("name"),"description":"Fixture","version":"1"
          }))
        }),
      )
      .route(
        "/api/v10/applications/42/commands/{id}",
        delete(move |Path(id): Path<String>| async move {
          let _ = deleted.send(id);
          StatusCode::NO_CONTENT
        }),
      ),
  )
  .await?;
  register(&crate::tests::http_for(&server)).await?;
  assert_eq!(removals.try_recv()?.as_str(), "11");
  assert_eq!(removals.try_recv()?.as_str(), "13");
  assert_eq!(removals.try_recv()?.as_str(), "14");
  assert!(removals.try_recv().is_err());
  Ok(())
}
