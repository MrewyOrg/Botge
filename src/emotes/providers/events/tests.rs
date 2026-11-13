//! Drives the 7TV watcher against loopback WebSocket connections and inspects its cache changes.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]
#![allow(
  clippy::let_underscore_must_use,
  reason = "Fixture receivers may close during teardown, and tracing initialization is shared"
)]

use tokio::{net::TcpListener, sync::oneshot};
use tokio_tungstenite::accept_async;

use super::*;
use crate::emotes::providers::Cached;

#[tokio::test]
async fn accepts_control_frames_and_times_out_a_silent_provider() -> Result<()> {
  for close in [true, false] {
    let client = std::sync::Arc::new(ProviderClient::new(None)?);
    client.cache.lock().await.insert(
      "set".into(),
      Cached {
        emotes: std::sync::Arc::from([]),
        expires: Instant::now(),
        set_id: Some("01234567890123456789012345".into()),
      },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("ws://{}", listener.local_addr()?);
    let worker = tokio::spawn(async move { client.event_session(&url).await });
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    socket.next().await.context("missing subscription")??;
    socket.send(Message::Binary(vec![1, 2, 3].into())).await?;
    socket.send(Message::Ping(Vec::new().into())).await?;
    loop {
      if socket.next().await.context("missing pong")??.is_pong() {
        break;
      }
    }
    if close {
      socket.close(None).await?;
      worker.await??;
    } else {
      tokio::time::pause();
      tokio::time::advance(Duration::from_secs(61)).await;
      let error = worker
        .await?
        .err()
        .context("silent provider did not time out")?;
      assert!(error.to_string().contains("heartbeat timed out"));
    }
  }
  Ok(())
}

#[tokio::test]
#[expect(
  clippy::too_many_lines,
  reason = "Keep the sequential fixture setup, actions, and assertions in one scenario"
)]
async fn subscribes_invalidates_changed_snapshots_and_unsubscribes_evicted_sets() -> Result<()> {
  let client = ProviderClient::new(None)?;
  let id = "01234567890123456789012345";
  client.cache.lock().await.insert(
    "set".into(),
    Cached {
      emotes: std::sync::Arc::from([]),
      expires: Instant::now() + Duration::from_secs(100),
      set_id: Some(id.into()),
    },
  );
  client.cache.lock().await.insert(
    "unrelated".into(),
    Cached {
      emotes: std::sync::Arc::from([]),
      expires: Instant::now() + Duration::from_secs(100),
      set_id: None,
    },
  );
  let listener = TcpListener::bind("127.0.0.1:0").await?;
  let url = format!("ws://{}", listener.local_addr()?);
  // Handshakes let the test inspect the cache between subscription, update, and eviction.
  let (subscribed, subscription) = oneshot::channel();
  let (update, should_update) = oneshot::channel();
  let (evicted, eviction) = oneshot::channel();
  let server = tokio::spawn(async move {
    let (stream, _) = listener.accept().await?;
    let mut socket = accept_async(stream).await?;
    socket
      .send(Message::Text(
        r#"{"op":1,"d":{"heartbeat_interval":10000}}"#.into(),
      ))
      .await?;
    let text = socket
      .next()
      .await
      .context("expected subscription")??
      .into_text()?;
    let command: Value = serde_json::from_str(&text)?;
    assert_eq!(command.get("op").and_then(Value::as_u64), Some(35));
    assert_eq!(
      command
        .pointer("/d/condition/object_id")
        .and_then(Value::as_str),
      Some(id)
    );
    let _ = subscribed.send(());
    should_update.await?;
    for event in [
      json!({"op":0,"d":{"type":"emote.update","body":{"id":id}}}),
      json!({"op":0,"d":{"type":"emote_set.update","body":{}}}),
    ] {
      socket.send(Message::Text(event.to_string().into())).await?;
    }
    socket
      .send(Message::Text(
        json!({"op":0,"d":{"type":"emote_set.update","body":{"id":id}}})
          .to_string()
          .into(),
      ))
      .await?;
    socket
      .send(Message::Text(r#"{"op":2,"d":{}}"#.into()))
      .await?;
    socket.send(Message::Ping(Vec::new().into())).await?;
    eviction.await?;
    while let Some(message) = socket.next().await {
      let message = message?;
      if let Message::Text(text) = message {
        let command: Value = serde_json::from_str(&text)?;
        assert_eq!(command.get("op").and_then(Value::as_u64), Some(36));
        break;
      }
    }
    socket
      .send(Message::Text(r#"{"op":4,"d":{}}"#.into()))
      .await?;
    Ok::<_, anyhow::Error>(())
  });
  let inspect = async {
    subscription.await?;
    {
      let mut cache = client.cache.lock().await;
      let set = cache.get_mut("set").context("cached set missing")?;
      assert!(set.expires <= Instant::now());
      set.expires = Instant::now() + Duration::from_secs(60);
      drop(cache);
    }
    let _ = update.send(());
    loop {
      if client
        .cache
        .lock()
        .await
        .get("set")
        .is_some_and(|set| set.expires <= Instant::now())
      {
        break;
      }
      tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let mut cache = client.cache.lock().await;
    let unrelated = cache.get("unrelated").context("unrelated feed missing")?;
    assert!(unrelated.expires > Instant::now());
    cache.clear();
    drop(cache);
    let _ = evicted.send(());
    Ok::<_, anyhow::Error>(())
  };
  let (session, inspected, server_result) = tokio::time::timeout(Duration::from_secs(8), async {
    tokio::join!(client.event_session(&url), inspect, server)
  })
  .await?;
  session?;
  inspected?;
  server_result??;
  Ok(())
}

#[tokio::test]
async fn keeps_watching_after_provider_disconnects_and_bad_events() -> Result<()> {
  async fn reconnect_after(message: &str) -> Result<()> {
    let client = ProviderClient::new(None)?;
    let id = "01234567890123456789012345";
    client.cache.lock().await.insert(
      "set".into(),
      Cached {
        emotes: std::sync::Arc::from([]),
        expires: Instant::now() + Duration::from_secs(60),
        set_id: Some(id.into()),
      },
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("ws://{}", listener.local_addr()?);
    // Match production's background task and cancel it when the fixture exits.
    let mut watchers = tokio::task::JoinSet::new();
    watchers.spawn(async move { client.watch_sets(&url).await });
    let server = async move {
      let (stream, _) = listener.accept().await?;
      let mut socket = accept_async(stream).await?;
      socket.send(Message::Text(message.into())).await?;
      let (stream, _) = listener.accept().await?;
      let mut reconnected = accept_async(stream).await?;
      let command = reconnected
        .next()
        .await
        .context("missing resubscription")??;
      let command: Value = serde_json::from_str(command.to_text()?)?;
      assert_eq!(command.get("op"), Some(&json!(35)));
      assert_eq!(command.pointer("/d/condition/object_id"), Some(&json!(id)));
      Ok::<_, anyhow::Error>(())
    };
    tokio::time::timeout(Duration::from_secs(15), server)
      .await
      .context("watcher did not reconnect and resubscribe")?
  }
  tokio::try_join!(
    reconnect_after(r#"{"op":4,"d":{}}"#),
    reconnect_after("invalid provider JSON")
  )?;
  Ok(())
}
