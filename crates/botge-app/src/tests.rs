//! Coordinates stored guild state and operator policy.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]
use botge_test_support::example;

use super::*;

#[tokio::test]
async fn disabled_provider_blocks_added_emotes_and_catalog_is_empty() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&dir.path().join("botge.redb"))?);
  let guild = NonZeroU64::MIN;
  assert!(store.add_emote(guild, example("Stored", "1"))?);
  let disabled = Application::new(Providers::default(), Arc::clone(&store), None)?;
  let catalog = disabled.catalog(Some(guild)).await?;
  assert!(catalog.is_empty(), "unexpected catalog emotes: {catalog:?}");
  assert!(
    disabled
      .fetch_added("01234567890123456789012345")
      .await?
      .is_none()
  );
  let enabled = Application::new(
    Providers {
      seven_added: true,
      ..Providers::default()
    },
    store,
    None,
  )?;
  assert_eq!(enabled.catalog(Some(guild)).await?.len(), 1);
  let catalog = enabled.catalog(None).await?;
  assert!(catalog.is_empty(), "unexpected catalog emotes: {catalog:?}");
  assert!(enabled.fetch_added("invalid").await?.is_none());
  Ok(())
}

#[tokio::test]
async fn cancels_a_loopback_event_worker_and_reports_closed_admission() -> Result<()> {
  use futures_util::SinkExt as _;
  use tokio::net::TcpListener;
  use tokio_tungstenite::{accept_async, tungstenite::Message};
  let listener = TcpListener::bind("127.0.0.1:0").await?;
  let endpoint = url::Url::parse(&format!("http://{}", listener.local_addr()?))?;
  let (connected, received) = tokio::sync::oneshot::channel();
  let server = tokio::spawn(async move {
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    socket.send(Message::Close(None)).await?;
    connected
      .send(())
      .map_err(|()| anyhow::anyhow!("fixture receiver closed"))?;
    Ok::<_, anyhow::Error>(())
  });
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("worker.redb"))?);
  let mut application = Application::new(Providers::default(), store, None)?;
  application.use_provider_fixture(endpoint);
  assert!(format!("{application:?}").contains("Application"));
  application.render_slot.close();
  std::assert_matches!(application.reserve_render_fixture().await, Err(_));
  let application = Arc::new(application);
  let worker = tokio::spawn(async move { application.watch_sets().await });
  tokio::time::timeout(std::time::Duration::from_secs(2), received).await??;
  worker.abort();
  std::assert_matches!(worker.await,Err(error) if error.is_cancelled());
  server.await??;
  Ok(())
}

#[tokio::test]
async fn reports_saved_state_and_blocking_task_failures() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("errors.redb"))?);
  let application = Application::new(Providers::default(), Arc::clone(&store), None)?;
  store.invalidate_table("emote_borders")?;
  std::assert_matches!(application.border_for_user(NonZeroU64::MIN).await, Err(_));
  let panicking = Application::new(
    Providers::default(),
    Arc::new(Store::panic_read_fixture()?),
    None,
  )?;
  std::assert_matches!(panicking.catalog(Some(NonZeroU64::MIN)).await, Err(_));
  let panicking = Application::new(
    Providers::default(),
    Arc::new(Store::panic_read_fixture()?),
    None,
  )?;
  std::assert_matches!(panicking.border_for_user(NonZeroU64::MIN).await, Err(_));
  Ok(())
}
