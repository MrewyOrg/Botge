// cspell:words initialise

//! Checks voice reconciliation decisions and status deduplication through local HTTP fixtures.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]
#![allow(
  clippy::let_underscore_must_use,
  reason = "Fixture receivers may close during teardown, and tracing initialization is shared"
)]

use super::*;

#[tokio::test]
async fn continues_after_a_blocking_database_task_panics() -> anyhow::Result<()> {
  use tracing::instrument::WithSubscriber as _;
  let store = Arc::new(Store::panic_read_fixture()?);
  let (_ready, receiver) = watch::channel(true);
  let output = crate::tests::TestLogs::default();
  let worker = tokio::spawn(
    reconcile(
      store,
      Songbird::serenity(),
      Arc::new(Http::new("fixture")),
      Arc::new(Notify::new()),
      receiver,
    )
    .with_subscriber(output.subscriber()),
  );
  tokio::time::timeout(Duration::from_secs(2), async {
    loop {
      if output.text()?.contains("voice settings task failed") {
        return Ok::<_, anyhow::Error>(());
      }
      tokio::time::sleep(Duration::from_millis(5)).await;
    }
  })
  .await??;
  assert!(!worker.is_finished());
  worker.abort();
  assert!(worker.await.is_err());
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn bounds_media_connection_and_preserves_transport_failures() -> anyhow::Result<()> {
  wait_for_media(std::future::ready(Ok::<(), std::io::Error>(()))).await?;
  let failure = wait_for_media(std::future::ready(Err::<(), _>(std::io::Error::other(
    "fixture media failure",
  ))))
  .await
  .err()
  .context("media failure was lost")?;
  assert!(failure.to_string().contains("fixture media failure"));
  let failure = wait_for_media(std::future::pending::<Result<(), std::io::Error>>())
    .await
    .err()
    .context("media deadline was not enforced")?;
  assert!(failure.to_string().contains("timed out"));
  Ok(())
}

#[tokio::test]
async fn recovers_after_unreadable_settings_without_exiting_the_worker() -> anyhow::Result<()> {
  use tracing::instrument::WithSubscriber as _;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("botge.redb"))?);
  store.invalidate_table("voice_settings")?;
  let changed = Arc::new(Notify::new());
  let (_ready, receiver) = watch::channel(true);
  let output = crate::tests::TestLogs::default();
  let subscriber = output.subscriber();
  let manager = Songbird::serenity_from_config(
    songbird::Config::default().gateway_timeout(Some(Duration::from_millis(10))),
  );
  manager.initialise_client_data(1, serenity::all::UserId::new(42));
  let worker = tokio::spawn(
    reconcile(
      Arc::clone(&store),
      Arc::clone(&manager),
      Arc::new(Http::new("fixture")),
      Arc::clone(&changed),
      receiver,
    )
    .with_subscriber(subscriber),
  );
  let wait_for_log = |expected: &'static str, count: usize| {
    let output = output.clone();
    async move {
      tokio::time::timeout(Duration::from_secs(2), async {
        loop {
          if output.text()?.matches(expected).count() >= count {
            return Ok::<_, anyhow::Error>(());
          }
          tokio::time::sleep(Duration::from_millis(5)).await;
        }
      })
      .await?
    }
  };
  wait_for_log("could not read saved voice settings", 1).await?;
  assert!(!worker.is_finished());
  store.restore_voice_table()?;
  let settings = VoiceSettings {
    channel_id: Some("42".into()),
    ..VoiceSettings::default()
  };
  store.save_voice_settings(NonZeroU64::MIN, &settings)?;
  changed.notify_one();
  wait_for_log("could not apply voice settings", 1).await?;
  let call = manager
    .get(GuildId(NonZeroU64::MIN))
    .context("voice retry discarded the call")?;
  assert_eq!(
    call
      .lock()
      .await
      .current_channel()
      .map(|channel| channel.0.get()),
    Some(42)
  );
  changed.notify_one();
  wait_for_log("could not apply voice settings", 2).await?;
  assert!(!worker.is_finished());
  assert_eq!(store.voice_settings(NonZeroU64::MIN)?, settings);
  worker.abort();
  assert!(worker.await.is_err());
  Ok(())
}

#[tokio::test]
async fn retains_saved_status_when_discord_rejects_an_update() -> anyhow::Result<()> {
  use axum::{Json, Router, http::StatusCode, routing::put};
  let server = crate::tests::TestServer::start(Router::new().route(
    "/api/v10/channels/1/voice-status",
    put(|| async {
      (
        StatusCode::FORBIDDEN,
        Json(serde_json::json!({"code":50013,"message":"Missing permissions"})),
      )
    }),
  ))
  .await?;
  let mut known = HashMap::from([(NonZeroU64::MIN, (NonZeroU64::MIN, "old".to_owned()))]);
  assert!(
    apply_status(
      &crate::tests::http_for(&server),
      NonZeroU64::MIN,
      NonZeroU64::MIN,
      Some("new"),
      &mut known
    )
    .await
    .is_err()
  );
  assert_eq!(
    known
      .get(&NonZeroU64::MIN)
      .map(|(_, status)| status.as_str()),
    Some("old")
  );
  Ok(())
}

#[tokio::test]
async fn refreshes_changed_voice_statuses_and_skips_duplicates() -> anyhow::Result<()> {
  use axum::{Json, Router, extract::Path, http::StatusCode, routing::put};
  use serde_json::{Value, json};
  use tokio::sync::mpsc;

  let (sender, mut updates) = mpsc::unbounded_channel();
  let fixture = crate::tests::TestServer::start(Router::new().route(
    "/api/v10/channels/{id}/voice-status",
    put(
      move |Path(id): Path<u64>, Json(body): Json<Value>| async move {
        let _ = sender.send((id, body));
        StatusCode::NO_CONTENT
      },
    ),
  ))
  .await?;
  let http = crate::tests::http_for(&fixture);
  let guild = NonZeroU64::MIN;
  let first = NonZeroU64::MIN;
  let second = NonZeroU64::new(2).context("invalid test channel")?;
  let mut known = HashMap::new();
  for (channel, status) in [
    (first, Some("wave")),
    (first, Some("wave")),
    (first, Some("changed")),
    (second, Some("changed")),
    (second, None),
    (second, Some("changed")),
  ] {
    apply_status(&http, guild, channel, status, &mut known).await?;
  }
  for (channel, status) in [(1, "wave"), (1, "changed"), (2, "changed"), (2, "changed")] {
    assert_eq!(updates.try_recv()?, (channel, json!({ "status": status })));
  }
  assert!(updates.try_recv().is_err());
  Ok(())
}

#[tokio::test]
async fn stops_reconciling_if_gateway_exits_before_ready() -> anyhow::Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("botge.redb"))?);
  let (ready, receiver) = watch::channel(false);
  drop(ready);
  tokio::time::timeout(
    Duration::from_secs(1),
    reconcile(
      store,
      Songbird::serenity(),
      Arc::new(Http::new("fixture")),
      Arc::new(Notify::new()),
      receiver,
    ),
  )
  .await?;
  Ok(())
}

#[test]
fn joins_or_refreshes_a_selected_channel_and_disconnects_when_cleared() {
  let first = NonZeroU64::MIN;
  let second = NonZeroU64::MAX;
  assert_eq!(connection_change(None, None), ConnectionChange::Keep);
  assert_eq!(
    connection_change(Some(first), Some(first)),
    ConnectionChange::Join(first)
  );
  assert_eq!(
    connection_change(None, Some(first)),
    ConnectionChange::Join(first)
  );
  assert_eq!(
    connection_change(Some(first), Some(second)),
    ConnectionChange::Join(second)
  );
  assert_eq!(
    connection_change(Some(first), None),
    ConnectionChange::Disconnect
  );
}
