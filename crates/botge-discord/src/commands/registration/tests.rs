//! Exercises registration command behavior.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::assert_matches;

use serde_json::{Value, json};
use tokio::sync::mpsc::error::TryRecvError;

use super::*;

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
          drop(deleted.send(id));
          StatusCode::NO_CONTENT
        }),
      ),
  )
  .await?;
  register(&crate::tests::http_for(&server)).await?;
  assert_eq!(removals.try_recv()?.as_str(), "11");
  assert_eq!(removals.try_recv()?.as_str(), "13");
  assert_eq!(removals.try_recv()?.as_str(), "14");
  assert_matches!(removals.try_recv(), Err(TryRecvError::Empty));
  Ok(())
}

#[tokio::test]
async fn stops_registration_when_discord_rejects_listing_creation_or_retirement() -> Result<()> {
  use axum::{Json, Router, http::StatusCode, routing::get};
  for stage in 0..3 {
    let server = crate::tests::TestServer::start(Router::new()
      .route("/api/v10/applications/42/commands", get(move || async move {
        if stage == 0 { (StatusCode::FORBIDDEN, Json(json!({"code":50013,"message":"denied"}))) }
        else { (StatusCode::OK, Json(json!([{"id":"11","application_id":"42","type":1,"name":"settings","description":"Fixture","version":"1"}]))) }
      }).post(move |Json(body): Json<Value>| async move {
        if stage == 1 { (StatusCode::FORBIDDEN, Json(json!({"code":50013,"message":"denied"}))) }
        else { (StatusCode::OK, Json(json!({"id":"14","application_id":"42","type":1,"name":body.get("name"),"description":"Fixture","version":"1"}))) }
      }))
      .route("/api/v10/applications/42/commands/11", axum::routing::delete(|| async { (StatusCode::FORBIDDEN, Json(json!({"code":50013,"message":"denied"}))) })))
      .await?;
    assert!(
      register(&crate::tests::http_for(&server)).await.is_err(),
      "stage {stage}"
    );
  }
  Ok(())
}
