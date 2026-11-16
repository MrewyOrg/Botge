//! Guessing game routes: ticket issue, the room connection, and round images.
//!
//! A browser cannot attach a bearer token to a WebSocket or an image request. The join
//! route therefore authorizes the caller as every other route does and returns a one-use
//! ticket, which the connection presents in its first message. Round images are addressed
//! by a random token that changes every round. All three routes require the Discord proxy
//! signature.

use std::{sync::Arc, time::Duration};

use axum::{
  Json,
  extract::{
    Path, State,
    ws::{Message, WebSocket, WebSocketUpgrade},
  },
  http::{HeaderMap, StatusCode, header},
  response::{IntoResponse as _, Response},
};
use serde::Deserialize;
use tokio::time::{Instant, MissedTickBehavior};

use super::{Activity, ApiError, GuildAccess};
use botge_app::{
  Application,
  game::{GameTicket, Guess, Seat},
};

/// The largest message a player may send; guesses are short.
const MAX_MESSAGE_BYTES: usize = 1024;
/// The longest guess checked against the answer.
const MAX_GUESS_BYTES: usize = 200;
/// How long a new connection may take to present its ticket.
const JOIN_DEADLINE: Duration = Duration::from_secs(10);
/// Guesses arriving faster than this are ignored.
const GUESS_INTERVAL: Duration = Duration::from_millis(200);
/// Keeps idle lobby connections open through intermediate proxies.
const PING_INTERVAL: Duration = Duration::from_secs(30);

/// The guild and Activity instance a player wants to join.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct JoinGame {
  guild_id: String,
  #[serde(default)]
  code: String,
  instance_id: String,
}

/// Messages a player sends over the room connection.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Command {
  Join { ticket: String },
  Start,
  Guess { text: String },
}

/// Issues a one-use ticket for the caller's room after verifying guild membership.
///
/// # Errors
///
/// Returns proxy, input, admission, or membership errors, and 409 while too many tickets
/// are waiting for a connection.
pub(super) async fn join<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<JoinGame>,
) -> Result<Json<GameTicket>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  Ok(Json(
    state
      .application
      .join_game(&state.access, guild, &credential, &request.instance_id)
      .await?,
  ))
}

/// Upgrades a signed proxy request to a room connection.
///
/// The connection holds one of the shared socket slots until it closes. Its first message
/// must present a ticket from [`join`] within ten seconds.
///
/// # Errors
///
/// Returns 401 for a failed proxy signature and 503 when every socket slot is in use.
pub(super) async fn connect<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  upgrade: WebSocketUpgrade,
) -> Result<Response, ApiError> {
  state.verify_proxy(&headers)?;
  let permit = Arc::clone(&state.sockets)
    .try_acquire_owned()
    .map_err(|_error| {
      ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "Botge is busy. Try again shortly.",
      )
    })?;
  let application = Arc::clone(&state.application);
  Ok(
    upgrade
      .max_message_size(MAX_MESSAGE_BYTES)
      .max_frame_size(MAX_MESSAGE_BYTES)
      .on_upgrade(move |socket| async move {
        session(socket, &application).await;
        drop(permit);
      }),
  )
}

/// Serves the image of a round that is still on screen.
///
/// # Errors
///
/// Returns 401 for a failed proxy signature and 404 for an unknown or finished round.
pub(super) async fn image<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Path(token): Path<String>,
) -> Result<Response, ApiError> {
  state.verify_proxy(&headers)?;
  let image = state
    .application
    .game_image(&token)
    .ok_or(ApiError::new(StatusCode::NOT_FOUND, "This round is over."))?;
  let content_type = match image.filename {
    "emote.gif" => "image/gif",
    "emote.jpg" => "image/jpeg",
    "emote.webp" => "image/webp",
    _ => "image/png",
  };
  Ok(
    (
      [
        (header::CONTENT_TYPE, content_type),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
      ],
      image.bytes.clone(),
    )
      .into_response(),
  )
}

/// Runs one player's connection until either side closes it.
///
/// Dropping the seat at the end frees the player's place and closes an empty room.
async fn session(mut socket: WebSocket, application: &Arc<Application>) {
  let Some(seat) = admit(&mut socket, application).await else {
    drop(
      socket
        .send(text(&serde_json::json!({
          "type": "error",
          "message": "Could not join the game. Reopen it to try again.",
        })))
        .await,
    );
    return;
  };
  let mut changes = seat.changes();
  let mut ping = tokio::time::interval(PING_INTERVAL);
  ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
  let mut last_guess: Option<Instant> = None;
  if send_state(&mut socket, &seat).await.is_err() {
    return;
  }
  loop {
    tokio::select! {
      update = changes.changed() => {
        if update.is_err() || send_state(&mut socket, &seat).await.is_err() {
          break;
        }
      }
      _ = ping.tick() => {
        if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
          break;
        }
      }
      message = socket.recv() => {
        let Some(Ok(message)) = message else { break };
        let Message::Text(body) = message else {
          if matches!(message, Message::Close(_)) {
            break;
          }
          continue;
        };
        let Ok(command) = serde_json::from_str::<Command>(&body) else { break };
        if !obey(&mut socket, &seat, command, &mut last_guess).await {
          break;
        }
      }
    }
  }
}

/// Waits for the first message and redeems its ticket.
async fn admit(socket: &mut WebSocket, application: &Arc<Application>) -> Option<Seat> {
  let message = tokio::time::timeout(JOIN_DEADLINE, socket.recv())
    .await
    .ok()??
    .ok()?;
  let Message::Text(body) = message else {
    return None;
  };
  let Ok(Command::Join { ticket }) = serde_json::from_str(&body) else {
    return None;
  };
  application.take_seat(&ticket)
}

/// Applies one command and reports whether the connection should stay open.
async fn obey(
  socket: &mut WebSocket,
  seat: &Seat,
  command: Command,
  last_guess: &mut Option<Instant>,
) -> bool {
  match command {
    Command::Join { .. } => false,
    Command::Start => {
      // A match that is already running keeps going; the snapshot shows its state.
      let _started = seat.start();
      true
    }
    Command::Guess { text: guess } => {
      let now = Instant::now();
      if guess.len() > MAX_GUESS_BYTES
        || last_guess.is_some_and(|last| now.duration_since(last) < GUESS_INTERVAL)
      {
        return true;
      }
      *last_guess = Some(now);
      seat.guess(&guess) != Guess::Wrong
        || socket
          .send(text(&serde_json::json!({ "type": "wrong" })))
          .await
          .is_ok()
    }
  }
}

/// Sends the room as it is now.
///
/// # Errors
///
/// Returns an error once the connection is closed.
async fn send_state(socket: &mut WebSocket, seat: &Seat) -> Result<(), axum::Error> {
  socket
    .send(text(&serde_json::json!({
      "type": "state",
      "state": seat.snapshot(),
    })))
    .await
}

fn text(value: &serde_json::Value) -> Message {
  Message::Text(value.to_string().into())
}

#[cfg(test)]
mod tests;
