//! Invalidates cached 7TV sets in response to WebSocket events and reconnects.

use std::{
  collections::BTreeSet,
  time::{Duration, Instant},
};

use anyhow::{Context as _, Result};
use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::{Value, json};
use tokio_tungstenite::{
  connect_async_with_config,
  tungstenite::{Message, protocol::WebSocketConfig},
};

use super::ProviderClient;

impl ProviderClient {
  /// Reconnects with a delay when the provider closes the stream or the heartbeat expires.
  pub(crate) async fn watch_sets(&self, endpoint: &str) {
    loop {
      if let Err(error) = self.event_session(endpoint).await {
        tracing::warn!(%error, "7TV event stream disconnected");
      }
      tokio::time::sleep(Duration::from_secs(10)).await;
    }
  }

  /// Watches only the 7TV sets represented in the current snapshot cache.
  ///
  /// A new session marks existing 7TV snapshots stale to recover events missed while offline.
  /// Each subscription pass compares the cache with the active subscriptions and removes
  /// subscriptions for evicted sets. Incoming updates mark their matching snapshots stale
  /// so a subsequent read can fetch fresh entries.
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
    let heartbeat = tokio::time::sleep(Duration::from_secs(60));
    tokio::pin!(heartbeat);
    loop {
      tokio::select! {
          message = socket.next() => {
              let Some(message) = message.transpose()? else { return Ok(()); };
              match message {
                  Message::Text(message) => {
                      let value: Value = serde_json::from_str(&message)?;
                      match value.get("op").and_then(Value::as_u64) {
                          Some(0) if value.pointer("/d/type").and_then(Value::as_str) == Some("emote_set.update") => {
                              if let Some(id) = value.pointer("/d/body/id").and_then(Value::as_str) {
                                  self.expire_sets(Some(id)).await;
                              }
                          }
                          Some(1 | 2) => heartbeat.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(60)),
                          Some(4 | 7) => return Ok(()),
                          _ => (),
                      }
                  }
                  Message::Close(_) => return Ok(()),
                  Message::Ping(_) => socket.flush().await?,
                  _ => (),
              }
          }
          _ = refresh.tick() => {
              let desired: BTreeSet<_> = self.cache.lock().await.values().filter_map(|entry| entry.set_id.clone()).collect();
              for (opcode, ids) in [(35, desired.difference(&subscriptions)), (36, subscriptions.difference(&desired))] {
                  for id in ids {
                      let payload = json!({"op":opcode,"d":{"type":"emote_set.update","condition":{"object_id":id}}});
                      tokio::time::timeout(Duration::from_secs(5), socket.send(Message::Text(payload.to_string().into())))
                          .await.context("7TV subscription timed out")??;
                  }
              }
              subscriptions = desired;
          }
          _ = &mut heartbeat => anyhow::bail!("7TV heartbeat timed out"),
      }
    }
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
