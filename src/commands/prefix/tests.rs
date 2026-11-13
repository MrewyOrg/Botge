//! Exercises prefix command behavior.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use super::*;

#[tokio::test]
async fn replies_with_input_errors_without_rendering_or_pinging_the_author() -> Result<()> {
  use axum::{Json, Router, routing::post};
  use serde_json::Value;
  use std::sync::Arc;
  use tokio::sync::mpsc;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  let commands = Commands::new(
    Arc::new(crate::emotes::Emotes::new(
      crate::config::Providers::default(),
      store,
      None,
    )?),
    None,
  );
  let (sent, mut replies) = mpsc::unbounded_channel();
  let reply = serde_json::to_value(Message::default())?;
  let server = crate::tests::TestServer::start(Router::new().route(
    "/api/v10/channels/42/messages",
    post(move |Json(body): Json<Value>| async move {
      assert!(sent.send(body).is_ok(), "reply receiver closed");
      Json(reply)
    }),
  ))
  .await?;
  let mut message = Message::default();
  message.id = serenity::all::MessageId::new(1);
  message.channel_id = serenity::all::ChannelId::new(42);
  message.author = serde_json::from_value(crate::tests::user("3"))?;
  for (content, expected) in [("+Missing:5", "1 to 4"), ("+Missing", "No available emote")] {
    message.content = content.into();
    commands
      .respond_message(&crate::tests::http_for(&server), &message)
      .await?;
    let response = replies.try_recv()?;
    assert!(
      response
        .get("content")
        .and_then(Value::as_str)
        .is_some_and(|text| text.contains(expected))
    );
    assert_eq!(
      response.pointer("/allowed_mentions/replied_user"),
      Some(&Value::Bool(false))
    );
  }
  message.webhook_id = Some(serenity::all::WebhookId::new(7));
  commands
    .respond_message(&crate::tests::http_for(&server), &message)
    .await?;
  message.webhook_id = None;
  message.kind = MessageType::PinsAdd;
  commands
    .respond_message(&crate::tests::http_for(&server), &message)
    .await?;
  assert!(replies.try_recv().is_err());
  Ok(())
}

#[test]
fn accepts_the_plus_prefix_only_when_attached_to_a_token() {
  assert_eq!(prefix_input("+Wave Hat"), Some("Wave Hat"));
  assert_eq!(prefix_input("+<:Wave:42>"), Some("<:Wave:42>"));
  for ignored in ["+", "+ Wave", "+\tWave", "++Wave", "a +Wave", "Wave"] {
    assert_eq!(prefix_input(ignored), None);
  }
}

#[test]
fn parses_provider_sizes_without_changing_emote_ids_or_image_urls() {
  let id = "7tv:123456789012345678901234";
  let url = "https://cdn.discordapp.com/attachments/1/2/emote.png?signature=foo:96";
  for input in ["Wave Hat", "Wave:96 Hat", "Wave:", "<:Wave:42>", id, url] {
    assert_eq!(prefix_size(input), Ok((input, None)));
  }
  for (input, names, size) in [
    ("Wave Hat:3  ", "Wave Hat", 3),
    ("Wave:1", "Wave", 1),
    ("<:Wave:42>:4", "<:Wave:42>", 4),
    ("7tv:123456789012345678901234:2", id, 2),
    (&format!("{url} :3"), url, 3),
  ] {
    assert_eq!(
      prefix_size(input),
      Ok((names, Some(size))),
      "input: {input}"
    );
  }
  for input in [
    "Wave:0",
    "Wave:5",
    "Wave:24",
    "Wave:96",
    "Wave:257",
    "Wave:65536",
  ] {
    assert!(
      prefix_size(input).is_err(),
      "accepted invalid size: {input}"
    );
  }
}
