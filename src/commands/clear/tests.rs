//! Simulates Discord confirmation callbacks, paginated message reads, and deletions.

use std::collections::HashMap;

use axum::{
  Json, Router,
  extract::{Path, Query},
  http::StatusCode,
  routing::{delete, get, patch, post},
};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::*;
use crate::tests::{TestServer, http_for, user};

fn member(admin: bool) -> Value {
  json!({
      "user":user("7"), "roles":[], "flags":0, "deaf":false, "mute":false,
      "permissions":if admin { "8" } else { "0" }
  })
}

/// Builds a modal submission whose snowflake controls its age relative to the command.
fn modal(custom_id: &str, answer: &str, admin: bool, id: u64) -> Result<ModalInteraction> {
  Ok(serde_json::from_value(json!({
      "id":id.to_string(), "application_id":"42", "guild_id":"1", "channel_id":"3",
      "token":"clear", "version":1, "app_permissions":REQUIRED.bits().to_string(),
      "member":member(admin), "user":user("7"),
      "locale":"en-US", "entitlements":[], "attachment_size_limit":10485760,
      "data":{"custom_id":custom_id,"components":[{"type":1,"components":[
          {"type":4,"custom_id":"confirm","value":answer}
      ]}]}
  }))?)
}

fn fixture_message(id: u64, pinned: bool) -> serenity::all::Message {
  let mut message = serenity::all::Message::default();
  message.id = MessageId::new(id);
  message.pinned = pinned;
  message
}

#[tokio::test]
async fn confirms_clear_and_skips_pins_new_messages_and_already_deleted_messages() -> Result<()> {
  let (sent, mut requests) = mpsc::unbounded_channel();
  let callback = sent.clone();
  let edit = sent.clone();
  let server = TestServer::start(
    Router::new()
      .route(
        "/api/v10/interactions/{id}/clear/callback",
        post(move |Json(body): Json<Value>| async move {
          let _ = callback.send(body);
          StatusCode::NO_CONTENT
        }),
      )
      .route(
        "/api/v10/webhooks/42/clear/messages/@original",
        patch(move |Json(body): Json<Value>| async move {
          let _ = edit.send(body);
          Json(fixture_message(50, false))
        }),
      )
      .route(
        "/api/v10/channels/3/messages",
        get(|Query(query): Query<HashMap<String, String>>| async move {
          Json(match query.get("before").map(String::as_str) {
            Some("10") => vec![
              fixture_message(20, false),
              fixture_message(9, false),
              fixture_message(8, true),
            ],
            Some("8") => vec![fixture_message(6, false)],
            Some("6") => vec![],
            _ => vec![fixture_message(1, false)],
          })
        }),
      )
      .route(
        "/api/v10/channels/3/messages/{id}",
        delete(move |Path(id): Path<String>| async move {
          let _ = sent.send(json!({"delete":id}));
          if id == "6" {
            (
              StatusCode::NOT_FOUND,
              Json(json!({"code":10008,"message":"Unknown Message"})),
            )
          } else {
            (StatusCode::OK, Json(json!({})))
          }
        }),
      ),
  )
  .await?;
  let http = http_for(&server);
  let command: CommandInteraction = serde_json::from_value(json!({
      "id":"10", "application_id":"42", "guild_id":"1", "channel_id":"3",
      "channel":{"id":"3","type":0}, "token":"clear", "version":1,
      "app_permissions":REQUIRED.bits().to_string(), "member":member(true), "user":user("7"),
      "locale":"en-US", "entitlements":[], "attachment_size_limit":10485760,
      "data":{"id":"7","type":1,"name":NAME}
  }))?;
  open(&http, &command).await?;
  let response = requests.try_recv()?;
  assert_eq!(response.get("type"), Some(&json!(9)));
  let custom_id = response
    .pointer("/data/custom_id")
    .and_then(Value::as_str)
    .ok_or_else(|| anyhow::anyhow!("missing confirmation ID"))?;
  assert_eq!(custom_id, "clear-messages:7:3:10");
  for (id, answer, admin, modal_id, expected) in [
    ("clear-messages:8:3:10", "Yes", true, 11, "canceled"),
    ("clear-messages:7:4:10", "Yes", true, 11, "canceled"),
    (custom_id, "No", true, 11, "canceled"),
    // Discord snowflakes store milliseconds above the low 22 bits.
    (custom_id, "Yes", true, (61_000u64 << 22) + 11, "expired"),
    (custom_id, "Yes", false, 11, "administrators"),
  ] {
    confirm(&http, modal(id, answer, admin, modal_id)?).await?;
    let denial = requests.try_recv()?;
    assert!(
      denial
        .pointer("/data/content")
        .and_then(Value::as_str)
        .is_some_and(|text| text.contains(expected))
    );
  }
  confirm(&http, modal(custom_id, "Yes", true, 11)?).await?;
  assert_eq!(requests.try_recv()?.get("type"), Some(&json!(5)));
  assert_eq!(requests.try_recv()?, json!({"delete":"9"}));
  assert_eq!(requests.try_recv()?, json!({"delete":"6"}));
  assert_eq!(
    requests.try_recv()?.get("content"),
    Some(&json!("Deleted 1 earlier messages."))
  );
  assert!(requests.try_recv().is_err());
  assert!(denied(command.member.as_deref(), Some(Permissions::VIEW_CHANNEL)).is_some());
  Ok(())
}
