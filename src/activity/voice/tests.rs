//! Exercises signed voice requests through the complete Activity router.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use axum::http::StatusCode;
use serde_json::{Value, json};
use std::{num::NonZeroU64, time::Duration};

use super::super::tests::Fixture;

#[tokio::test]
async fn reports_persistence_failures_without_notifying_the_voice_worker() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  fixture.store.invalidate_table("voice_settings")?;
  for (path, body) in [
    ("/settings", json!({"guildId":"1","code":"admin"})),
    (
      "/settings/voice",
      json!({"guildId":"1","code":"admin","voice":{"channelId":null,"statusEnabled":false,"statusEmoji":null}}),
    ),
  ] {
    assert_eq!(
      fixture.post(path, &body, true).await?.0,
      StatusCode::INTERNAL_SERVER_ERROR
    );
  }
  assert!(
    tokio::time::timeout(Duration::from_millis(20), fixture.changed.notified())
      .await
      .is_err()
  );
  Ok(())
}

#[tokio::test]
async fn saves_a_channel_and_clears_it_without_losing_the_status_preference() -> anyhow::Result<()>
{
  let fixture = Fixture::new()?;
  let (status, read) = fixture
    .post("/settings", &json!({"guildId": "1", "code": "admin"}), true)
    .await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(read.pointer("/voice/channelId"), Some(&Value::Null));
  assert_eq!(
    read.pointer("/channels/0/id").and_then(Value::as_str),
    Some("42")
  );
  for channel_id in [Some("42"), None] {
    let settings =
      json!({ "channelId": channel_id, "statusEnabled": true, "statusEmoji": "<:Botge:123>" });
    let (status, response) = fixture
      .post(
        "/settings/voice",
        &json!({
            "guildId": "1", "code": "admin", "voice": settings
        }),
        true,
      )
      .await?;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(response.get("voice"), Some(&settings));
    tokio::time::timeout(Duration::from_secs(1), fixture.changed.notified()).await?;
    let saved = fixture.store.voice_settings(NonZeroU64::MIN)?;
    assert_eq!(saved.channel_id.as_deref(), channel_id);
    assert_eq!(saved.status(), Some("<:Botge:123>"));
  }
  Ok(())
}
