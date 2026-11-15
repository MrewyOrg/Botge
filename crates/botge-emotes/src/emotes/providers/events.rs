//! Invalidates cached 7TV sets in response to WebSocket events and reconnects.

use std::{
  collections::BTreeSet,
  sync::atomic::Ordering,
  time::{Duration, Instant},
};

use anyhow::{Context as _, Result};
use futures_util::{Sink, SinkExt as _, StreamExt as _};
use serde_json::{Value, json};
use tokio_tungstenite::{
  connect_async_with_config,
  tungstenite::{self, Message, protocol::WebSocketConfig},
};

use super::ProviderClient;

/// How long the session waits for a 7TV hello or heartbeat before reconnecting.
const HEARTBEAT: Duration = Duration::from_secs(60);

/// What the session loop does after a text frame.
enum Event {
  /// The server confirmed the connection is alive.
  Heartbeat,
  /// The server asked the client to reconnect.
  Close,
  /// A dispatch or unknown frame; the loop continues.
  Other,
}

impl ProviderClient {
  /// Reconnects with a delay when the provider closes the stream or the heartbeat expires.
  #[expect(
    clippy::infinite_loop,
    reason = "The reconnect worker runs until its task is cancelled during shutdown"
  )]
  pub(crate) async fn watch_sets(&self, endpoint: &str) {
    loop {
      if let Err(error) = self.event_session(endpoint).await {
        tracing::warn!(%error, message = "7TV event stream disconnected");
      }
      self.reconnects.fetch_add(1, Ordering::Relaxed);
      tokio::time::sleep(Duration::from_secs(10)).await;
    }
  }

  /// Watches only the 7TV sets represented in the current snapshot cache.
  ///
  /// A new session marks existing 7TV snapshots stale to recover events missed while offline.
  /// Each subscription pass compares the cache with the active subscriptions and removes
  /// subscriptions for evicted sets. Incoming updates mark their matching snapshots stale
  /// so a subsequent read can fetch fresh entries.
  ///
  /// # Errors
  ///
  /// Returns an error for connection, subscription, read, or decoding failures, or an expired
  /// heartbeat deadline. A clean close returns successfully. The outer worker reconnects
  /// after either outcome; the new session marks existing cached sets stale.
  async fn event_session(&self, endpoint: &str) -> Result<()> {
    let config = WebSocketConfig::default()
      .max_message_size(Some(1024 * 1024))
      .max_frame_size(Some(1024 * 1024));
    let (mut socket, _) = tokio::time::timeout(
      Duration::from_secs(8),
      connect_async_with_config(endpoint, Some(config), false),
    )
    .await??;
    // Refresh snapshots after reconnect so changes missed while offline are recovered.
    self.expire_sets(None).await;
    let mut subscriptions = BTreeSet::new();
    let mut refresh = tokio::time::interval(Duration::from_secs(5));
    let heartbeat = tokio::time::sleep(HEARTBEAT);
    tokio::pin!(heartbeat);
    loop {
      tokio::select! {
        message = socket.next() => match message {
          None | Some(Ok(Message::Close(_))) => return Ok(()),
          Some(Ok(Message::Text(text))) => match self.handle_text(&text).await? {
            Event::Heartbeat => heartbeat.as_mut().reset(tokio::time::Instant::now() + HEARTBEAT),
            Event::Close => return Ok(()),
            Event::Other => (),
          },
          Some(Ok(Message::Ping(_))) => socket.flush().await?,
          Some(Ok(_)) => (),
          Some(Err(error)) => return Err(error.into()),
        },
        _ = refresh.tick() => self.sync_subscriptions(&mut socket, &mut subscriptions).await?,
        () = &mut heartbeat => anyhow::bail!("7TV heartbeat timed out"),
      }
    }
  }

  /// Marks the updated set stale and classifies the frame for the session loop.
  ///
  /// # Errors
  ///
  /// Returns an error if the frame is not valid JSON.
  async fn handle_text(&self, text: &str) -> Result<Event> {
    let value: Value = serde_json::from_str(text)?;
    Ok(match value.get("op").and_then(Value::as_u64) {
      Some(0) if value.pointer("/d/type").and_then(Value::as_str) == Some("emote_set.update") => {
        if let Some(id) = value.pointer("/d/body/id").and_then(Value::as_str) {
          self.expire_sets(Some(id)).await;
        }
        Event::Other
      }
      Some(1 | 2) => Event::Heartbeat,
      Some(4 | 7) => Event::Close,
      _ => Event::Other,
    })
  }

  /// Subscribes to newly cached sets and unsubscribes from evicted ones.
  ///
  /// `subscriptions` is replaced only after every message is sent.
  ///
  /// # Errors
  ///
  /// Returns an error if a message cannot be sent or a send exceeds five seconds.
  async fn sync_subscriptions<S>(
    &self,
    socket: &mut S,
    subscriptions: &mut BTreeSet<String>,
  ) -> Result<()>
  where
    S: Sink<Message, Error = tungstenite::Error> + Unpin,
  {
    let desired: BTreeSet<_> = self
      .cache
      .lock()
      .await
      .values()
      .filter_map(|entry| entry.set_id.clone())
      .collect();
    for (opcode, ids) in [
      (35, desired.difference(subscriptions)),
      (36, subscriptions.difference(&desired)),
    ] {
      for id in ids {
        let payload = json!({
          "op": opcode,
          "d": { "type": "emote_set.update", "condition": { "object_id": id } },
        });
        let send = socket.send(Message::Text(payload.to_string().into()));
        tokio::time::timeout(Duration::from_secs(5), send)
          .await
          .context("7TV subscription timed out")??;
      }
    }
    *subscriptions = desired;
    Ok(())
  }

  /// Marks one set or all cached sets stale while retaining their last usable snapshots.
  ///
  /// `None` marks every entry that has a 7TV set ID. Feeds without a set ID are unaffected.
  async fn expire_sets(&self, set_id: Option<&str>) {
    let now = Instant::now();
    for entry in self.cache.lock().await.values_mut() {
      if entry
        .set_id
        .as_deref()
        .is_some_and(|id| set_id.is_none_or(|target| id == target))
      {
        entry.expires = now;
      }
    }
  }
}

#[cfg(test)]
mod tests;
