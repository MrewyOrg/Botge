use super::*;

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
