//! In-memory rooms for the emote guessing game.
//!
//! A room belongs to one Activity instance in one guild and exists only while a player is
//! seated. Each round shows one emote from the guild's own additions and selected feeds;
//! the first player to type its name scores, and earlier answers score more. A short ready
//! beat lets every player load the picture before the timer starts, wrong guesses are shared
//! with the room, and a masked name reveals up to two letters as the round runs. The browser
//! blurs the picture, so a round's image is published under a random token and the name is
//! withheld until the reveal. Nothing here is persisted.

use std::{
  collections::{HashMap, HashSet},
  num::NonZeroU64,
  sync::{Arc, Mutex, MutexGuard, PoisonError},
  time::Duration,
  vec,
};

use anyhow::{Context as _, Result};
use botge_domain::emotes::Emote;
use botge_emotes::rendering::{self, Image, Layer};
use serde::Serialize;
use tokio::{sync::watch, time::Instant};
use url::Url;

pub use self::room::{Guess, Score, SharedGuess, Snapshot};
use self::{
  play::{Rounds, run_match},
  random::{shuffle, token},
  room::Room,
};
use crate::{
  Application,
  access::{AccessError, Credential, FailureKind, GuildAccess, membership, user_id},
};

mod play;
mod random;
mod room;

/// Rounds in one match; a smaller pool shortens the match to one round per emote.
pub const ROUNDS: usize = 10;
/// Distinct eligible emotes a guild needs before a match can start.
pub const MIN_POOL: usize = 10;
/// How long players have to name an emote.
pub const ROUND_TIME: Duration = Duration::from_secs(20);
/// How long players see "get ready" while the round image loads, before the timer starts.
pub const READY_TIME: Duration = Duration::from_secs(3);
/// How long the answer stays on screen before the next round.
pub const REVEAL_TIME: Duration = Duration::from_secs(5);
/// When the hint shows the name's first letter.
const FIRST_LETTER: Duration = Duration::from_secs(10);
/// When the hint shows a second letter from the middle of the name.
const SECOND_LETTER: Duration = Duration::from_secs(15);

/// Rooms the process keeps at once.
const MAX_ROOMS: usize = 32;
/// Unredeemed tickets kept at once; expired ones are dropped before this is checked.
const MAX_TICKETS: usize = 512;
/// How long a ticket can wait for its connection.
const TICKET_LIFETIME: Duration = Duration::from_secs(30);
/// How long one round image may take to download before the emote is skipped.
const IMAGE_DEADLINE: Duration = Duration::from_secs(10);
/// Provider scale requested for round images.
const IMAGE_SCALE: u16 = 2;
/// Longest Activity instance identifier accepted.
const MAX_INSTANCE_LENGTH: usize = 128;

/// A guild and the Activity instance playing in it.
type RoomKey = (NonZeroU64, String);

/// Every open room and the tickets waiting for a connection.
#[derive(Debug, Default)]
pub struct Games {
  rooms: Mutex<HashMap<RoomKey, Arc<Room>>>,
  tickets: Mutex<HashMap<String, Ticket>>,
  cache: Option<Url>,
}

/// An authorized player who has not connected yet.
#[derive(Debug)]
struct Ticket {
  key: RoomKey,
  user: NonZeroU64,
  expires: Instant,
}

/// A one-use ticket and the account it was issued to.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameTicket {
  /// Redeemed once by [`Application::take_seat`] within 30 seconds.
  pub ticket: String,
  /// The caller's Discord account ID, so the browser can mark its own score.
  pub user_id: String,
}

/// A connected player's handle on a room; dropping it frees the place.
#[derive(Debug)]
pub struct Seat {
  application: Arc<Application>,
  room: Arc<Room>,
  user: NonZeroU64,
}

impl Seat {
  /// A counter that changes whenever [`Self::snapshot`] would differ.
  #[must_use]
  pub fn changes(&self) -> watch::Receiver<u64> {
    self.room.changed.subscribe()
  }

  /// The room as it is now.
  #[must_use]
  pub fn snapshot(&self) -> Snapshot {
    self.room.snapshot()
  }

  /// Starts a match from the lobby or the final scoreboard.
  ///
  /// Returns `false` while a match is already loading or running. The match loads the
  /// guild's emotes in the background and reports a failure through the snapshot's notice.
  #[must_use]
  pub fn start(&self) -> bool {
    if !self.room.open_match() {
      return false;
    }
    let task = tokio::spawn(run_match(
      Arc::clone(&self.application),
      Arc::clone(&self.room),
    ));
    self.room.lock().task = Some(task);
    self.room.publish();
    true
  }

  /// Checks this player's guess against the open round.
  #[must_use]
  pub fn guess(&self, text: &str) -> Guess {
    self.room.guess(self.user, text)
  }
}

impl Drop for Seat {
  fn drop(&mut self) {
    let mut rooms = self.application.games.rooms();
    if self.room.leave(self.user)
      && rooms
        .get(&self.room.key)
        .is_some_and(|room| Arc::ptr_eq(room, &self.room))
    {
      rooms.remove(&self.room.key);
    }
  }
}

impl Games {
  fn rooms(&self) -> MutexGuard<'_, HashMap<RoomKey, Arc<Room>>> {
    self.rooms.lock().unwrap_or_else(PoisonError::into_inner)
  }

  fn tickets(&self) -> MutexGuard<'_, HashMap<String, Ticket>> {
    self.tickets.lock().unwrap_or_else(PoisonError::into_inner)
  }
}

impl Application {
  /// Routes round image downloads through the operator's media cache.
  pub fn set_game_cache(&mut self, cache: Option<Url>) {
    self.games.cache = cache;
  }

  /// Verifies the caller's guild membership and issues a ticket for one game connection.
  ///
  /// The room itself is created when the ticket is redeemed, so an unused ticket leaves
  /// nothing behind once it expires.
  ///
  /// # Errors
  ///
  /// Returns an error for a malformed instance ID, a credential that cannot prove current
  /// membership of `guild`, or too many tickets waiting for a connection.
  pub async fn join_game<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    instance: &str,
  ) -> Result<GameTicket, AccessError> {
    if instance.is_empty()
      || instance.len() > MAX_INSTANCE_LENGTH
      || !instance
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
      return Err(AccessError::INVALID);
    }
    membership(access, guild, credential).await?;
    let user = user_id(access, credential).await?;
    let now = Instant::now();
    let ticket = token();
    let mut tickets = self.games.tickets();
    tickets.retain(|_, ticket| ticket.expires > now);
    if tickets.len() >= MAX_TICKETS {
      return Err(BUSY);
    }
    tickets.insert(
      ticket.clone(),
      Ticket {
        key: (guild, instance.to_owned()),
        user,
        expires: now + TICKET_LIFETIME,
      },
    );
    drop(tickets);
    Ok(GameTicket {
      ticket,
      user_id: user.to_string(),
    })
  }

  /// Redeems a ticket once and seats its player, creating the room if needed.
  ///
  /// Returns `None` for an unknown, used, or expired ticket, a full room, or when the
  /// process already keeps its maximum number of rooms.
  #[must_use]
  pub fn take_seat(self: &Arc<Self>, ticket: &str) -> Option<Seat> {
    let Ticket { key, user, expires } = self.games.tickets().remove(ticket)?;
    if expires <= Instant::now() {
      return None;
    }
    let mut rooms = self.games.rooms();
    let room = if let Some(room) = rooms.get(&key) {
      Arc::clone(room)
    } else {
      if rooms.len() >= MAX_ROOMS {
        return None;
      }
      let room = Arc::new(Room::new(key.clone()));
      rooms.insert(key, Arc::clone(&room));
      room
    };
    if !room.sit(user) {
      return None;
    }
    drop(rooms);
    Some(Seat {
      application: Arc::clone(self),
      room,
      user,
    })
  }

  /// Returns the image of a round that is still on screen.
  ///
  /// The token is random and changes every round, so it identifies neither the room nor
  /// the emote.
  #[must_use]
  pub fn game_image(&self, token: &str) -> Option<Arc<Image>> {
    let rooms: Vec<_> = self.games.rooms().values().map(Arc::clone).collect();
    rooms.iter().find_map(|room| room.image(token))
  }

  /// Downloads one emote's original bytes for a round.
  ///
  /// # Errors
  ///
  /// Returns an error for a missing image URL, a failed or slow download, or an image
  /// over the renderer's per-input byte limit, which bounds what a room keeps in memory.
  async fn round_image(&self, emote: &Emote) -> Result<Image> {
    let layer = Layer::emote_at(emote, IMAGE_SCALE).context("emote has no image")?;
    tokio::time::timeout(
      IMAGE_DEADLINE,
      rendering::original(self.client.http(), &layer, self.games.cache.as_ref()),
    )
    .await?
  }
}

impl Rounds for Application {
  /// Picks this match's emotes in play order, with spares for failed downloads.
  ///
  /// The pool is the guild's individual additions and selected feeds without overlay
  /// emotes, one entry per case-insensitive name. Returns the number of rounds and the
  /// shuffled picks, or `None` when fewer than [`MIN_POOL`] emotes are eligible.
  ///
  /// # Errors
  ///
  /// Returns an error if saved guild state cannot be read.
  async fn pool(&self, guild: NonZeroU64) -> Result<Option<(usize, Vec<Emote>)>> {
    let store = Arc::clone(&self.store);
    let added_enabled = self.policy.seven_added;
    let (added, settings) = tokio::task::spawn_blocking(move || {
      let added = if added_enabled {
        store.added_emotes(guild)?
      } else {
        vec![]
      };
      Ok::<_, anyhow::Error>((added, store.guild_emotes(guild)?))
    })
    .await??;
    let catalog = self.client.guild_catalog(&settings, added).await;
    let mut names = HashSet::new();
    let mut pool: Vec<_> = catalog
      .iter()
      .filter(|emote| {
        !emote.overlaying
          && !emote.name.trim().is_empty()
          && Layer::emote_at(emote, IMAGE_SCALE).is_some()
          && names.insert(emote.name.to_lowercase())
      })
      .collect();
    if pool.len() < MIN_POOL {
      return Ok(None);
    }
    shuffle(&mut pool);
    let rounds = pool.len().min(ROUNDS);
    Ok(Some((
      rounds,
      pool.into_iter().take(rounds * 3).cloned().collect(),
    )))
  }

  /// Takes picks until one downloads, skipping emotes whose image is unavailable.
  async fn next(&self, picks: &mut vec::IntoIter<Emote>) -> Option<(String, Image)> {
    for emote in picks {
      match self.round_image(&emote).await {
        Ok(image) => return Some((emote.name, image)),
        Err(error) => tracing::warn!(%error, message = "Skipped a game round image"),
      }
    }
    None
  }
}

/// Too many tickets are waiting; the caller can retry shortly.
const BUSY: AccessError = AccessError(
  FailureKind::Conflict,
  "Too many games are starting right now. Try again shortly.",
);

#[cfg(test)]
mod tests;
