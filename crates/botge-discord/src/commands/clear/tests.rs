//! Simulates Discord confirmation callbacks, paginated message reads, and deletions.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::{assert_matches, collections::HashMap};

use axum::{
  Json, Router,
  extract::{Path, Query},
  http::StatusCode,
  routing::{delete, get, patch, post},
};
use serde_json::{Value, json};
use tokio::sync::mpsc::{self, error::TryRecvError};
use tracing::instrument::WithSubscriber as _;

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
          drop(callback.send(body));
          StatusCode::NO_CONTENT
        }),
      )
      .route(
        "/api/v10/webhooks/42/clear/messages/@original",
        patch(move |Json(body): Json<Value>| async move {
          drop(edit.send(body));
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
          drop(sent.send(json!({"delete":id})));
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
    std::sync::Arc::new(botge_app::Application::new(
      botge_domain::providers::Providers::default(),
      store,
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
    "clear-messages:7:3",
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
  assert_matches!(requests.try_recv(), Err(TryRecvError::Empty));
  assert!(denied(command.member.as_deref(), Some(Permissions::VIEW_CHANNEL)).is_some());
  assert_eq!(
    denied(command.member.as_deref(), Some(Permissions::ADMINISTRATOR)),
    None
  );
  let mut unrelated = modal(custom_id, "Yes", true, 11)?;
  if let Some(ActionRowComponent::InputText(input)) = unrelated
    .data
    .components
    .first_mut()
    .and_then(|row| row.components.first_mut())
  {
    input.custom_id = "another-field".into();
  }
  assert!(confirmed_before(&unrelated).is_none());
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
          drop(feedback.send(body));
          Json(fixture_message(50, false))
        }),
      ),
  )
  .await?;
  let logs = botge_test_support::TestLogs::default();
  confirm(
    &http_for(&server),
    modal("clear-messages:7:3:10", "Yes", true, 11)?,
  )
  .with_subscriber(logs.subscriber())
  .await?;
  assert!(logs.text()?.contains("could not clear channel"));
  assert!(
    replies
      .try_recv()?
      .get("content")
      .and_then(Value::as_str)
      .is_some_and(|value| value.contains("Some may already have been deleted"))
  );
  Ok(())
}

#[tokio::test]
async fn propagates_callback_failures_and_rejects_unrelated_confirmations() -> Result<()> {
  let server = TestServer::start(Router::new()).await?;
  let http = http_for(&server);
  assert!(confirmed_before(&modal("foreign", "Yes", true, 11)?).is_none());
  for (answer, admin) in [("Yes", false), ("No", true), ("Yes", true)] {
    assert_matches!(
      confirm(&http, modal("clear-messages:7:3:10", answer, admin, 11)?).await,
      Err(_)
    );
  }
  let command: CommandInteraction = serde_json::from_value(json!({
    "id":"10", "application_id":"42", "channel_id":"3", "token":"clear", "version":1,
    "user":user("7"), "locale":"en-US", "entitlements":[], "attachment_size_limit":10_485_760,
    "data":{"id":"7", "type":1, "name":NAME}
  }))?;
  assert_matches!(open(&http, &command).await, Err(_));
  Ok(())
}

/// A message ID created `days` after the Discord epoch; snowflakes keep milliseconds above bit 22.
fn days(days: u64) -> MessageId {
  MessageId::new((days * 24 * 60 * 60 * 1000) << 22)
}

/// Serves one history page with recent, pinned, and old messages, recording deletions.
async fn history_server(
  page_delay: Duration,
) -> Result<(TestServer, mpsc::UnboundedReceiver<Value>)> {
  let (sent, requests) = mpsc::unbounded_channel();
  let bulk = sent.clone();
  let server = TestServer::start(
    Router::new()
      .route(
        "/api/v10/channels/3/messages",
        get(
          move |Query(query): Query<HashMap<String, String>>| async move {
            tokio::time::sleep(page_delay).await;
            let first = query.get("before") == Some(&days(20).to_string());
            let mut pinned = fixture_message(days(18).get() + 1, true);
            pinned.pinned = true;
            Json(if first {
              vec![
                fixture_message(days(19).get(), false),
                fixture_message(days(18).get(), false),
                pinned,
                fixture_message(days(3).get(), false),
              ]
            } else {
              vec![]
            })
          },
        ),
      )
      .route(
        "/api/v10/channels/3/messages/bulk-delete",
        post(move |Json(body): Json<Value>| async move {
          drop(bulk.send(json!({"bulk": body.get("messages")})));
          StatusCode::NO_CONTENT
        }),
      )
      .route(
        "/api/v10/channels/3/messages/{id}",
        delete(move |Path(id): Path<String>| async move {
          drop(sent.send(json!({"delete": id})));
          StatusCode::NO_CONTENT
        }),
      ),
  )
  .await?;
  Ok((server, requests))
}

#[tokio::test]
async fn bulk_deletes_recent_messages_and_deletes_older_ones_individually() -> Result<()> {
  let (server, mut requests) = history_server(Duration::ZERO).await?;
  let http = http_for(&server);
  let now = days(20).created_at();
  let later = tokio::time::Instant::now() + Duration::from_secs(60);
  let outcome = purge(&http, ChannelId::new(3), days(20), now, later).await?;
  assert_eq!(
    outcome,
    Purge {
      deleted: 3,
      complete: true
    }
  );
  // Messages under two weeks old share one bulk request; the pinned one is skipped.
  assert_eq!(
    requests.try_recv()?,
    json!({"bulk": [days(19).to_string(), days(18).to_string()]})
  );
  // Discord refuses to bulk-delete a 17-day-old message, so it is deleted on its own.
  assert_eq!(requests.try_recv()?, json!({"delete": days(3).to_string()}));
  assert_matches!(requests.try_recv(), Err(TryRecvError::Empty));
  Ok(())
}

#[tokio::test]
async fn stops_at_the_time_budget_and_reports_partial_progress() -> Result<()> {
  let now = days(20).created_at();
  let (server, mut requests) = history_server(Duration::ZERO).await?;
  let expired = purge(
    &http_for(&server),
    ChannelId::new(3),
    days(20),
    now,
    tokio::time::Instant::now(),
  )
  .await?;
  assert_eq!(
    expired,
    Purge {
      deleted: 0,
      complete: false
    }
  );
  assert_matches!(requests.try_recv(), Err(TryRecvError::Empty));

  // The budget runs out while the page loads: the bulk batch finishes, the old message waits.
  let (slow, mut requests) = history_server(Duration::from_millis(300)).await?;
  let soon = tokio::time::Instant::now() + Duration::from_millis(100);
  let partial = purge(&http_for(&slow), ChannelId::new(3), days(20), now, soon).await?;
  assert_eq!(
    partial,
    Purge {
      deleted: 2,
      complete: false
    }
  );
  assert!(requests.try_recv()?.get("bulk").is_some());
  assert_matches!(requests.try_recv(), Err(TryRecvError::Empty));
  Ok(())
}
