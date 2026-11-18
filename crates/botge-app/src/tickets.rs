//! One-use tickets that carry an HTTP authorization over to a WebSocket connection.
//!
//! A browser cannot attach a bearer token to a WebSocket, so an authorized HTTP route issues a
//! ticket and the connection redeems it in its first message.

use std::{
  collections::HashMap,
  sync::{Mutex, PoisonError},
  time::Duration,
};

use tokio::time::Instant;

use crate::game::token;

/// Unredeemed tickets kept at once; expired ones are dropped before this is checked.
pub(crate) const MAX_TICKETS: usize = 512;
/// How long a ticket can wait for its connection.
pub(crate) const TICKET_LIFETIME: Duration = Duration::from_secs(30);

/// Tickets waiting for a connection, each holding what its redemption grants.
#[derive(Debug)]
pub(crate) struct Tickets<T> {
  waiting: Mutex<HashMap<String, (T, Instant)>>,
}

impl<T> Default for Tickets<T> {
  fn default() -> Self {
    Self {
      waiting: Mutex::new(HashMap::new()),
    }
  }
}

impl<T> Tickets<T> {
  /// Issues a random ticket for `grant`, valid for [`TICKET_LIFETIME`].
  ///
  /// Returns `None` while [`MAX_TICKETS`] unexpired tickets are waiting.
  pub(crate) fn issue(&self, grant: T) -> Option<String> {
    let now = Instant::now();
    let mut waiting = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
    waiting.retain(|_, (_, expires)| *expires > now);
    if waiting.len() >= MAX_TICKETS {
      return None;
    }
    let ticket = token();
    waiting.insert(ticket.clone(), (grant, now + TICKET_LIFETIME));
    drop(waiting);
    Some(ticket)
  }

  /// Redeems a ticket once. Returns `None` for an unknown, used, or expired ticket.
  pub(crate) fn redeem(&self, ticket: &str) -> Option<T> {
    let (grant, expires) = self
      .waiting
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .remove(ticket)?;
    (expires > Instant::now()).then_some(grant)
  }

  /// Whether no ticket is waiting.
  #[cfg(test)]
  pub(crate) fn is_empty(&self) -> bool {
    self
      .waiting
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .is_empty()
  }
}
