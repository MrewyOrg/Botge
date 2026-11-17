//! The upgrade and liveness rules shared by the game and catalog watch connections.
//!
//! Both connections hold one of the API's shared socket slots, present a ticket in their first
//! message within [`JOIN_DEADLINE`], and are pinged every [`PING_INTERVAL`] to stay open through
//! intermediate proxies.

use std::{sync::Arc, time::Duration};

use axum::{
  extract::ws::{Message, WebSocket, WebSocketUpgrade},
  http::{HeaderMap, StatusCode},
  response::Response,
};
use tokio::time::{Instant, Interval, MissedTickBehavior};

use super::{Activity, ApiError, GuildAccess};
use botge_app::Application;

/// How long a new connection may take to present its ticket.
pub(super) const JOIN_DEADLINE: Duration = Duration::from_secs(10);
/// Keeps idle connections open through intermediate proxies.
pub(super) const PING_INTERVAL: Duration = Duration::from_secs(30);
/// How long a connection that has answered a ping may then stay silent before it is closed.
///
/// Two missed answers cover one slow reply without dropping a live peer.
pub(super) const SILENCE_LIMIT: Duration = Duration::from_secs(60);

/// The messages a session exchanges with its peer.
///
/// Sessions depend on this instead of the socket type so that their timeout and failed-delivery
/// paths can be exercised without a network connection.
pub(super) trait Connection {
  /// The next message, or `None` once the peer has closed the connection.
  fn receive(&mut self) -> impl Future<Output = Option<Result<Message, axum::Error>>> + Send;

  /// Sends one message.
  ///
  /// # Errors
  ///
  /// Returns an error once the connection is closed.
  fn deliver(&mut self, message: Message) -> impl Future<Output = Result<(), axum::Error>> + Send;
}

impl Connection for WebSocket {
  fn receive(&mut self) -> impl Future<Output = Option<Result<Message, axum::Error>>> + Send {
    self.recv()
  }

  fn deliver(&mut self, message: Message) -> impl Future<Output = Result<(), axum::Error>> + Send {
    self.send(message)
  }
}

/// Upgrades a signed proxy request and runs `session` while holding one shared socket slot.
///
/// Messages larger than `max_message_bytes` close the connection.
///
/// # Errors
///
/// Returns 401 for a failed proxy signature and 503 when every socket slot is in use.
pub(super) fn upgrade<A, S, F>(
  state: &Activity<A>,
  headers: &HeaderMap,
  upgrade: WebSocketUpgrade,
  max_message_bytes: usize,
  session: S,
) -> Result<Response, ApiError>
where
  A: GuildAccess,
  S: FnOnce(WebSocket, Arc<Application>) -> F + Send + 'static,
  F: Future<Output = ()> + Send + 'static,
{
  state.verify_proxy(headers)?;
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
      .max_message_size(max_message_bytes)
      .max_frame_size(max_message_bytes)
      .on_upgrade(move |socket| async move {
        session(socket, application).await;
        drop(permit);
      }),
  )
}

/// A ping timer that waits out missed ticks instead of bursting.
pub(super) fn pings() -> Interval {
  let mut ping = tokio::time::interval(PING_INTERVAL);
  ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
  ping
}

/// Tracks whether a peer still answers.
///
/// A phone that suspends the app or loses its network often leaves the connection open without
/// closing it, so a peer that has answered a ping and then sends nothing for [`SILENCE_LIMIT`] is
/// treated as gone. A peer whose answers never arrive, as when a proxy on the way answers pings
/// itself, is kept until the connection closes.
pub(super) struct Liveness {
  heard: Instant,
  answers_pings: bool,
}

impl Liveness {
  pub(super) fn new() -> Self {
    Self {
      heard: Instant::now(),
      answers_pings: false,
    }
  }

  /// Records a message from the peer; a pong also shows that it answers pings.
  pub(super) fn heard(&mut self, pong: bool) {
    self.heard = Instant::now();
    self.answers_pings |= pong;
  }

  /// Whether a peer that answered pings has since been silent for [`SILENCE_LIMIT`].
  pub(super) fn silent(&self) -> bool {
    self.answers_pings && self.heard.elapsed() >= SILENCE_LIMIT
  }
}
