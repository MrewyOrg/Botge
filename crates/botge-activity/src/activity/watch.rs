//! Catalog watch routes: ticket issue and the connection that reports catalog changes.
//!
//! A browser cannot attach a bearer token to a WebSocket, so the watch route authorizes the
//! caller as the catalog route does and returns a one-use ticket. The connection presents it
//! in its first message, then receives `{"type":"changed"}` whenever the guild's catalog may
//! have changed. Messages carry no catalog data; the Activity reloads it through the catalog
//! route. Both routes require the Discord proxy signature.

use std::{sync::Arc, time::Duration};

use axum::{
  Json,
  extract::{
    State,
    ws::{Message, WebSocketUpgrade},
  },
  http::HeaderMap,
  response::Response,
};
use serde::Deserialize;

use super::{
  Activity, ApiError, GuildAccess, ReadSettings,
  socket::{self, Connection, JOIN_DEADLINE, Liveness},
};
use botge_app::{Application, CatalogWatcher, WatchTicket};

/// The largest message a watcher may send; it only presents a ticket.
const MAX_MESSAGE_BYTES: usize = 256;
/// The longest a connection stays open; the Activity reconnects, rechecking membership.
const MAX_LIFETIME: Duration = Duration::from_hours(1);

/// The one message a watcher sends.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Command {
  Watch { ticket: String },
}

/// Issues a one-use watch ticket after verifying guild membership.
///
/// # Errors
///
/// Returns proxy, input, admission, or membership errors, and 409 while too many tickets
/// are waiting for a connection.
pub(super) async fn watch<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<WatchTicket>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  Ok(Json(
    state
      .application
      .watch_catalog(&state.access, guild, &credential)
      .await?,
  ))
}

/// Upgrades a request to a watch connection.
///
/// The connection shares the socket slots with game connections. Its first message must
/// present a ticket from [`watch`] within [`JOIN_DEADLINE`].
///
/// # Errors
///
/// Returns 503 when every socket slot is in use.
pub(super) async fn connect<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  upgrade: WebSocketUpgrade,
) -> Result<Response, ApiError> {
  socket::upgrade(
    &state,
    upgrade,
    MAX_MESSAGE_BYTES,
    |socket, application| async move { session(socket, &application).await },
  )
}

fn text(value: &serde_json::Value) -> Message {
  Message::Text(value.to_string().into())
}

/// Reports changes until either side closes, the peer goes silent, or the lifetime ends.
///
/// Silence follows [`Liveness`], as in the game connection. Any message other than a ping or
/// pong ends the session.
async fn session(mut socket: impl Connection, application: &Application) {
  let Some(mut watcher) = admit(&mut socket, application).await else {
    drop(
      socket
        .deliver(text(&serde_json::json!({
          "type": "error",
          "message": "Could not watch the catalog.",
        })))
        .await,
    );
    return;
  };
  if socket
    .deliver(text(&serde_json::json!({"type": "watching"})))
    .await
    .is_err()
  {
    return;
  }
  let lifetime = tokio::time::sleep(MAX_LIFETIME);
  tokio::pin!(lifetime);
  let mut ping = socket::pings();
  let mut liveness = Liveness::new();
  loop {
    tokio::select! {
      () = watcher.changed() => {
        if socket.deliver(text(&serde_json::json!({"type": "changed"}))).await.is_err() {
          break;
        }
      }
      _ = ping.tick() => {
        if liveness.silent() {
          break;
        }
        if socket.deliver(Message::Ping(Vec::new().into())).await.is_err() {
          break;
        }
      }
      message = socket.receive() => {
        match message {
          Some(Ok(Message::Pong(_))) => liveness.heard(true),
          Some(Ok(Message::Ping(_))) => liveness.heard(false),
          _ => break,
        }
      }
      () = &mut lifetime => {
        drop(socket.deliver(Message::Close(None)).await);
        break;
      }
    }
  }
}

/// Waits for the first message and redeems its ticket.
async fn admit(socket: &mut impl Connection, application: &Application) -> Option<CatalogWatcher> {
  let message = tokio::time::timeout(JOIN_DEADLINE, socket.receive())
    .await
    .ok()??
    .ok()?;
  let Message::Text(body) = message else {
    return None;
  };
  let Ok(Command::Watch { ticket }) = serde_json::from_str(&body) else {
    return None;
  };
  application.redeem_catalog_watch(&ticket)
}

#[cfg(test)]
mod tests;
