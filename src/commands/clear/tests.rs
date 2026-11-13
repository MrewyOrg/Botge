//! Simulates Discord confirmation callbacks, paginated message reads, and deletions.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]
#![allow(
  clippy::let_underscore_must_use,
  reason = "Fixture receivers may close during teardown, and tracing initialization is shared"
)]

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
      "locale":"en-US", "entitlements":[], "attachment_size_limit":10_485_760,
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
#[expect(
  clippy::literal_string_with_formatting_args,
  reason = "Braces identify Axum route captures, not Rust formatting arguments"
)]
#[expect(
  clippy::too_many_lines,
  reason = "Keep the sequential confirmation and deletion scenario together"
)]
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
      "locale":"en-US", "entitlements":[], "attachment_size_limit":10_485_760,
      "data":{"id":"7","type":1,"name":NAME}
  }))?;
  let directory = tempfile::tempdir()?;
  let store = std::sync::Arc::new(crate::storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  let commands = crate::commands::Commands::new(
    std::sync::Arc::new(crate::emotes::Emotes::new(
      crate::config::Providers::default(),
      store,
      None,
    )?),
    None,
  );
  for mode in 0..3 {
    let mut denied_command = command.clone();
    match mode {
      0 => denied_command.guild_id = None,
      1 => denied_command.channel = None,
      _ => denied_command.member = None,
    }
    commands.respond(&http, denied_command).await?;
    let denial = requests.try_recv()?;
    assert_eq!(denial.get("type"), Some(&json!(4)));
  }
  commands.respond(&http, command.clone()).await?;
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
    commands
      .modal(&http, modal(id, answer, admin, modal_id)?)
      .await?;
    let denial = requests.try_recv()?;
    assert!(
      denial
        .pointer("/data/content")
        .and_then(Value::as_str)
        .is_some_and(|text| text.contains(expected))
    );
  }
  for invalid in [
    "clear-messages:",
    "clear-messages:7",
    "clear-messages:7:3:bad",
    "clear-messages:bad:3:10",
    "clear-messages:7:bad:10",
  ] {
    assert!(confirmed_before(&modal(invalid, "Yes", true, 11)?).is_none());
  }
  commands
    .modal(&http, modal("foreign", "Yes", true, 11)?)
    .await?;
  commands
    .modal(&http, modal(custom_id, "Yes", true, 11)?)
    .await?;
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

#[tokio::test]
async fn reports_partial_cleanup_when_discord_refuses_a_deletion() -> Result<()> {
  let (feedback, mut replies) = mpsc::unbounded_channel();
  let server = TestServer::start(
    Router::new()
      .route(
        "/api/v10/interactions/11/clear/callback",
        post(|| async { StatusCode::NO_CONTENT }),
      )
      .route(
        "/api/v10/channels/3/messages",
        get(|| async { Json(vec![fixture_message(9, false)]) }),
      )
      .route(
        "/api/v10/channels/3/messages/9",
        delete(|| async {
          (
            StatusCode::FORBIDDEN,
            Json(json!({"code":50013,"message":"Missing permissions"})),
          )
        }),
      )
      .route(
        "/api/v10/webhooks/42/clear/messages/@original",
        patch(move |Json(body): Json<Value>| async move {
          let _ = feedback.send(body);
          Json(fixture_message(50, false))
        }),
      ),
  )
  .await?;
  confirm(
    &http_for(&server),
    modal("clear-messages:7:3:10", "Yes", true, 11)?,
  )
  .await?;
  assert!(
    replies
      .try_recv()?
      .get("content")
      .and_then(Value::as_str)
      .is_some_and(|value| value.contains("Some may already have been deleted"))
  );
  Ok(())
}
