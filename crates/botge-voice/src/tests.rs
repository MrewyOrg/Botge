// cspell:words initialise

//! Checks voice reconciliation decisions and status deduplication through local HTTP fixtures.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::assert_matches;

use tokio::sync::mpsc::error::TryRecvError;

use super::*;

#[tokio::test]
async fn continues_after_a_blocking_database_task_panics() -> anyhow::Result<()> {
  use tracing::instrument::WithSubscriber as _;
  let store = Arc::new(Store::panic_read_fixture()?);
  let (_ready, receiver) = watch::channel(true);
  let output = test_support::TestLogs::default();
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
  std::assert_matches!(worker.await, Err(_));
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
  let output = test_support::TestLogs::default();
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
  std::assert_matches!(worker.await, Err(_));
  Ok(())
}

#[tokio::test]
async fn retains_saved_status_when_discord_rejects_an_update() -> anyhow::Result<()> {
  use axum::{Json, Router, http::StatusCode, routing::put};
  let server = test_support::TestServer::start(Router::new().route(
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
  std::assert_matches!(
    apply_status(
      &test_support::http_for(&server),
      NonZeroU64::MIN,
      NonZeroU64::MIN,
      Some("new"),
      &mut known
    )
    .await,
    Err(_)
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
  let fixture = test_support::TestServer::start(Router::new().route(
    "/api/v10/channels/{id}/voice-status",
    put(
      move |Path(id): Path<u64>, Json(body): Json<Value>| async move {
        drop(sender.send((id, body)));
        StatusCode::NO_CONTENT
      },
    ),
  ))
  .await?;
  let http = test_support::http_for(&fixture);
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
  assert_matches!(updates.try_recv(), Err(TryRecvError::Empty));
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

#[test]
fn records_failed_media_without_treating_success_as_a_reconciliation_failure() -> anyhow::Result<()>
{
  let output = test_support::TestLogs::default();
  tracing::subscriber::with_default(output.subscriber(), || {
    assert!(report_media(NonZeroU64::MIN, Ok(())));
    assert!(!report_media(
      NonZeroU64::MIN,
      Err(anyhow::anyhow!("fixture media failed")),
    ));
  });
  let text = output.text()?;
  assert_eq!(text.matches("voice media connection failed").count(), 1);
  assert!(text.contains("fixture media failed"));
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn bounds_a_guild_with_a_busy_call_without_stopping_other_reconciliation()
-> anyhow::Result<()> {
  use tracing::instrument::WithSubscriber as _;
  let manager = Songbird::serenity();
  manager.initialise_client_data(1, serenity::all::UserId::new(42));
  let call = manager.get_or_insert(GuildId(NonZeroU64::MIN));
  let held = call.lock().await;
  let logs = test_support::TestLogs::default();
  let mut known = Guilds::default();
  assert!(
    !apply_bounded(
      &manager,
      &Http::new("fixture"),
      NonZeroU64::MIN,
      &VoiceSettings::default(),
      &mut known,
    )
    .with_subscriber(logs.subscriber())
    .await
  );
  assert!(logs.text()?.contains("timed out applying voice settings"));
  drop(held);
  assert!(
    apply_bounded(
      &manager,
      &Http::new("fixture"),
      NonZeroU64::MIN,
      &VoiceSettings::default(),
      &mut known,
    )
    .await
  );
  assert!(known.statuses.is_empty());
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn retains_status_after_its_deadline_and_clears_an_unconfirmed_gateway_join()
-> anyhow::Result<()> {
  use axum::{Router, http::StatusCode, routing::put};
  let server = test_support::TestServer::start(Router::new().route(
    "/api/v10/channels/1/voice-status",
    put(std::future::pending::<StatusCode>),
  ))
  .await?;
  let mut known = HashMap::from([(NonZeroU64::MIN, (NonZeroU64::MIN, "old".into()))]);
  let error = apply_status(
    &test_support::http_for(&server),
    NonZeroU64::MIN,
    NonZeroU64::MIN,
    Some("new"),
    &mut known,
  )
  .await
  .err()
  .context("status deadline was ignored")?;
  assert!(error.to_string().contains("timed out"));
  assert_eq!(
    known.get(&NonZeroU64::MIN).map(|(_, text)| text.as_str()),
    Some("old")
  );
  let manager = Songbird::serenity_from_config(
    songbird::Config::default().gateway_timeout(Some(Duration::from_millis(10))),
  );
  manager.initialise_client_data(1, serenity::all::UserId::new(42));
  let settings = VoiceSettings {
    channel_id: Some("42".into()),
    ..VoiceSettings::default()
  };
  let mut guilds = Guilds {
    statuses: known,
    ..Guilds::default()
  };
  std::assert_matches!(
    apply(
      &manager,
      &test_support::http_for(&server),
      NonZeroU64::MIN,
      &settings,
      &mut guilds
    )
    .await,
    Err(_)
  );
  apply(
    &manager,
    &test_support::http_for(&server),
    NonZeroU64::MIN,
    &VoiceSettings::default(),
    &mut guilds,
  )
  .await?;
  assert_eq!(
    manager
      .get(GuildId(NonZeroU64::MIN))
      .and_then(|call| call.try_lock().ok().and_then(|call| call.current_channel())),
    None
  );
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn preserves_diagnostics_before_a_tracing_subscriber_is_installed() -> anyhow::Result<()> {
  let Some(logs) = test_support::legacy_logging_fixture(
    "tests::preserves_diagnostics_before_a_tracing_subscriber_is_installed",
  )?
  else {
    return Ok(());
  };
  let manager = Songbird::serenity_from_config(
    songbird::Config::default().gateway_timeout(Some(Duration::from_millis(10))),
  );
  manager.initialise_client_data(1, serenity::all::UserId::new(42));
  let mut known = Guilds::default();
  let directory = tempfile::tempdir()?;
  let invalid = Arc::new(Store::open(&directory.path().join("logs.redb"))?);
  invalid.invalidate_table("voice_settings")?;
  apply_saved(invalid, &manager, &Http::new("fixture"), &mut known, true).await;
  apply_saved(
    Arc::new(Store::panic_read_fixture()?),
    &manager,
    &Http::new("fixture"),
    &mut known,
    true,
  )
  .await;
  apply_bounded(
    &manager,
    &Http::new("fixture"),
    NonZeroU64::MIN,
    &VoiceSettings {
      channel_id: Some("42".into()),
      ..VoiceSettings::default()
    },
    &mut known,
  )
  .await;
  let call = manager.get_or_insert(GuildId(NonZeroU64::MIN));
  let held = call.lock().await;
  apply_bounded(
    &manager,
    &Http::new("fixture"),
    NonZeroU64::MIN,
    &VoiceSettings::default(),
    &mut known,
  )
  .await;
  drop(held);
  assert!(!report_media(
    NonZeroU64::MIN,
    Err(anyhow::anyhow!("fixture media unavailable")),
  ));
  for expected in [
    "could not read saved voice settings",
    "voice settings task failed",
    "could not apply voice settings",
    "timed out applying voice settings",
    "voice media connection failed",
  ] {
    assert!(logs.text()?.contains(expected), "{expected}");
  }
  Ok(())
}

#[test]
fn doubles_backoff_for_failing_guilds_up_to_an_hour_and_clears_it_on_success() {
  let guild = NonZeroU64::MIN;
  let start = Instant::now();
  let mut guilds = Guilds::default();
  assert!(!guilds.backing_off(guild, start));
  for (failure, minutes) in [(1, 1), (2, 2), (3, 4), (7, 60), (12, 60)] {
    while guilds.retry.get(&guild).map_or(0, |(count, _)| *count) < failure {
      guilds.record(guild, false, start);
    }
    let wait = Duration::from_mins(minutes);
    assert!(guilds.backing_off(guild, start + wait - Duration::from_secs(1)));
    assert!(
      !guilds.backing_off(guild, start + wait),
      "failure {failure}"
    );
  }
  guilds.record(guild, true, start);
  assert!(!guilds.backing_off(guild, start));
}

#[tokio::test(start_paused = true)]
async fn skips_backing_off_guilds_on_periodic_passes_but_not_forced_ones() -> anyhow::Result<()> {
  use tracing::instrument::WithSubscriber as _;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("botge.redb"))?);
  let settings = VoiceSettings {
    channel_id: Some("42".into()),
    ..VoiceSettings::default()
  };
  store.save_voice_settings(NonZeroU64::MIN, &settings)?;
  let manager = Songbird::serenity_from_config(
    songbird::Config::default().gateway_timeout(Some(Duration::from_millis(10))),
  );
  manager.initialise_client_data(1, serenity::all::UserId::new(42));
  let http = Http::new("fixture");
  let logs = test_support::TestLogs::default();
  let mut guilds = Guilds::default();
  let failures = |guilds: &Guilds| guilds.retry.get(&NonZeroU64::MIN).map(|(count, _)| *count);
  apply_saved(Arc::clone(&store), &manager, &http, &mut guilds, false)
    .with_subscriber(logs.subscriber())
    .await;
  assert_eq!(failures(&guilds), Some(1));
  // Still backing off: a periodic pass leaves the guild alone.
  apply_saved(Arc::clone(&store), &manager, &http, &mut guilds, false)
    .with_subscriber(logs.subscriber())
    .await;
  assert_eq!(failures(&guilds), Some(1));
  // A settings change or gateway event retries at once.
  apply_saved(Arc::clone(&store), &manager, &http, &mut guilds, true)
    .with_subscriber(logs.subscriber())
    .await;
  assert_eq!(failures(&guilds), Some(2));
  assert_eq!(
    logs
      .text()?
      .matches("could not apply voice settings")
      .count(),
    2
  );
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn refreshes_only_status_for_a_call_that_is_already_connected() -> anyhow::Result<()> {
  use axum::{Json, Router, http::StatusCode, routing::put};
  use serde_json::{Value, json};
  use tokio::sync::mpsc;

  let (sender, mut updates) = mpsc::unbounded_channel();
  let server = test_support::TestServer::start(Router::new().route(
    "/api/v10/channels/42/voice-status",
    put(move |Json(body): Json<Value>| async move {
      drop(sender.send(body));
      StatusCode::NO_CONTENT
    }),
  ))
  .await?;
  let manager = Songbird::serenity_from_config(
    songbird::Config::default().gateway_timeout(Some(Duration::from_millis(10))),
  );
  manager.initialise_client_data(1, serenity::all::UserId::new(7));
  let channel = NonZeroU64::new(42).context("invalid test channel")?;
  // Complete the gateway handshake by hand, as Discord's voice events would.
  let handle = manager.get_or_insert(GuildId(NonZeroU64::MIN));
  let mut call = handle.lock().await;
  drop(call.join_gateway(VoiceChannelId(channel)).await);
  call.update_state("session".into(), Some(VoiceChannelId(channel)));
  call.update_server("voice.invalid".into(), "token".into());
  assert!(call.current_connection().is_some());
  drop(call);
  let settings = VoiceSettings {
    channel_id: Some("42".into()),
    status_enabled: true,
    status_emoji: Some("🎵".into()),
  };
  let mut guilds = Guilds::default();
  guilds.connected.insert(NonZeroU64::MIN);
  // A rejoin would wait for Discord and time out; a healthy call only refreshes its status.
  apply(
    &manager,
    &test_support::http_for(&server),
    NonZeroU64::MIN,
    &settings,
    &mut guilds,
  )
  .await?;
  assert_eq!(updates.try_recv()?, json!({ "status": "🎵" }));
  assert!(guilds.connected.contains(&NonZeroU64::MIN));

  // Without a recorded healthy media connection, the worker reconnects media. The fixture
  // endpoint cannot connect, so the guild stays unhealthy and the status is not sent again.
  guilds.connected.clear();
  apply(
    &manager,
    &test_support::http_for(&server),
    NonZeroU64::MIN,
    &settings,
    &mut guilds,
  )
  .await?;
  assert!(!guilds.connected.contains(&NonZeroU64::MIN));
  assert_matches!(updates.try_recv(), Err(TryRecvError::Empty));
  Ok(())
}
