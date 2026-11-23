//! Catalog change notifications for open Activities.
//!
//! An adapter authorizes a watcher with [`Application::watch_catalog`], which checks guild
//! membership and returns a one-use ticket, and redeems it with
//! [`Application::redeem_catalog_watch`] on its connection. Notifications carry no catalog data:
//! the Activity reloads the catalog through its authorized route, so a watcher learns only that
//! something changed.
//!
//! Changes are announced after a committed addition, removal or emote settings save, and when
//! 7TV reports an edit to a set that a guild uses.

use std::num::NonZeroU64;

use botge_emotes::SetChange;
use serde::Serialize;
use tokio::sync::broadcast::{self, error::RecvError};

use crate::{
  Application,
  access::{AccessError, Credential, FailureKind, GuildAccess, membership},
  tickets::Tickets,
};

/// Changes buffered for slow watchers; one that falls further behind reloads once.
const CHANGE_BUFFER: usize = 256;

const BUSY: AccessError = AccessError(
  FailureKind::Conflict,
  "Too many catalog connections are starting right now. Try again shortly.",
);

/// Which catalogs a change affects.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CatalogChange {
  /// One guild's additions, settings or personal 7TV set.
  Guild(NonZeroU64),
  /// A feed every guild shares, such as 7TV's global set.
  All,
}

/// The change channel and the tickets waiting for a connection.
#[derive(Debug)]
pub(crate) struct CatalogWatch {
  changes: broadcast::Sender<CatalogChange>,
  /// Guilds whose members have been authorized to watch but have not connected yet.
  tickets: Tickets<NonZeroU64>,
}

impl Default for CatalogWatch {
  fn default() -> Self {
    Self {
      changes: broadcast::channel(CHANGE_BUFFER).0,
      tickets: Tickets::default(),
    }
  }
}

/// A one-use ticket for one catalog watch connection.
#[derive(Debug, Serialize)]
pub struct WatchTicket {
  /// Presented in the connection's first message.
  pub ticket: String,
}

/// A redeemed watch on one guild's catalog.
#[derive(Debug)]
pub struct CatalogWatcher {
  guild: NonZeroU64,
  changes: broadcast::Receiver<CatalogChange>,
  /// Keeps the channel open, so the receiver never reports it closed.
  _open: broadcast::Sender<CatalogChange>,
}

impl CatalogWatcher {
  /// Waits for the next change that affects this guild's catalog.
  ///
  /// Changes missed because this watcher fell behind count as one change.
  pub async fn changed(&mut self) {
    loop {
      match self.changes.recv().await {
        // The watcher holds a sender, so an error can only mean missed changes.
        Ok(CatalogChange::All) | Err(_) => return,
        Ok(CatalogChange::Guild(guild)) if guild == self.guild => return,
        Ok(CatalogChange::Guild(_)) => {}
      }
    }
  }
}

impl Application {
  /// Verifies the caller's guild membership and issues a ticket for one watch connection.
  ///
  /// # Errors
  ///
  /// Returns an error for a credential that cannot prove current membership of `guild`, or
  /// too many tickets waiting for a connection.
  pub async fn watch_catalog<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<WatchTicket, AccessError> {
    membership(access, guild, credential).await?;
    let ticket = self.catalog_watch.tickets.issue(guild).ok_or(BUSY)?;
    Ok(WatchTicket { ticket })
  }

  /// Redeems a ticket once and starts watching its guild's catalog.
  ///
  /// Returns `None` for an unknown, used, or expired ticket.
  #[must_use]
  pub fn redeem_catalog_watch(&self, ticket: &str) -> Option<CatalogWatcher> {
    let guild = self.catalog_watch.tickets.redeem(ticket)?;
    Some(CatalogWatcher {
      guild,
      changes: self.catalog_watch.changes.subscribe(),
      _open: self.catalog_watch.changes.clone(),
    })
  }

  /// Announces a committed catalog change to every open watch.
  pub(crate) fn catalog_changed(&self, change: CatalogChange) {
    // Sending fails only when nobody watches, which needs no handling.
    drop(self.catalog_watch.changes.send(change));
  }

  /// Turns 7TV set edits into catalog changes for the guilds that use each set.
  ///
  /// The global set affects every guild. A personal set affects the guilds whose saved policy
  /// selects it. Missed set edits count as a change to every catalog.
  pub(crate) async fn relay_set_changes(&self, mut sets: broadcast::Receiver<SetChange>) {
    loop {
      match sets.recv().await {
        Ok(SetChange { global: true, .. }) | Err(RecvError::Lagged(_)) => {
          self.catalog_changed(CatalogChange::All);
        }
        Ok(SetChange { id, .. }) => {
          let store = std::sync::Arc::clone(&self.store);
          match crate::operations::database(move || store.guilds_with_seven_tv_set(&id)).await {
            Ok(guilds) => {
              for guild in guilds {
                self.catalog_changed(CatalogChange::Guild(guild));
              }
            }
            Err(error) => tracing::warn!(
              %error,
              message = "Could not find the guilds using a changed 7TV set"
            ),
          }
        }
        Err(RecvError::Closed) => return,
      }
    }
  }
}

#[cfg(test)]
mod tests;
