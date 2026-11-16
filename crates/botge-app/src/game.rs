// cspell:words Deque

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
  collections::{HashMap, HashSet, VecDeque},
  hash::{BuildHasher as _, RandomState},
  num::NonZeroU64,
  sync::{
    Arc, Mutex, MutexGuard, PoisonError,
    atomic::{AtomicU64, Ordering},
  },
  time::Duration,
};

use anyhow::{Context as _, Result};
use botge_domain::emotes::Emote;
use botge_emotes::rendering::{self, Image, Layer};
use serde::Serialize;
use tokio::{sync::watch, task::JoinHandle, time::Instant};
use url::Url;

use crate::{
  Application,
  access::{AccessError, Credential, FailureKind, GuildAccess, membership, user_id},
};

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

/// Rooms the process keeps at once.
const MAX_ROOMS: usize = 32;
/// Players one room accepts, counting players who left with a score.
const MAX_PLAYERS: usize = 25;
/// Unredeemed tickets kept at once; expired ones are dropped before this is checked.
const MAX_TICKETS: usize = 512;
/// How long a ticket can wait for its connection.
const TICKET_LIFETIME: Duration = Duration::from_secs(30);
/// The largest round image kept in memory; larger emotes are skipped.
const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
/// How long one round image may take to download before the emote is skipped.
const IMAGE_DEADLINE: Duration = Duration::from_secs(10);
/// Provider scale requested for round images.
const IMAGE_SCALE: u16 = 2;
/// Wrong guesses of the current round shared with the room; older ones drop off.
const MAX_SHARED_GUESSES: usize = 8;
/// Characters of a wrong guess shared with the room.
const MAX_SHARED_GUESS_CHARS: usize = 40;
/// Longest Activity instance identifier accepted.
const MAX_INSTANCE_LENGTH: usize = 128;

const TOO_FEW_EMOTES: &str =
  "This server needs at least 10 added or personal emotes to play. Add more and try again.";
const POOL_UNAVAILABLE: &str = "Botge could not load this server's emotes. Try again.";
const IMAGES_UNAVAILABLE: &str = "Botge could not load any emote images. Try again.";

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

/// The outcome of one guess.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Guess {
  /// The guess named the emote and ended the round.
  Correct,
  /// A round is open and the guess did not match.
  Wrong,
  /// No round is open, so the guess was ignored.
  Closed,
}

/// One player's place in the scoreboard.
#[derive(Debug, Serialize)]
pub struct Score {
  /// Discord account ID.
  pub id: String,
  /// Points in the current or last match.
  pub score: u32,
}

/// A wrong guess shown to the whole room.
#[derive(Debug, Serialize)]
pub struct SharedGuess {
  /// Discord account ID of the player who guessed.
  pub id: String,
  /// The guess, shortened to 40 characters.
  pub text: String,
}

/// The room as every player sees it.
///
/// The answer is present only in the reveal phase. Remaining time is relative to the moment
/// the snapshot was taken, so the browser does not depend on the server's clock.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  /// One of `lobby`, `loading`, `ready`, `round`, `reveal`, or `final`.
  pub phase: &'static str,
  /// The current round, counted from one; zero before the first round.
  pub round: usize,
  /// Rounds in this match.
  pub rounds: usize,
  /// The random token of this round's image.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub image: Option<String>,
  /// Milliseconds until the ready beat, round, or reveal ends.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub remaining_ms: Option<u64>,
  /// The full length of a round in milliseconds.
  pub round_ms: u64,
  /// The name with hidden letters as underscores, while the round is open.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub hint: Option<String>,
  /// The emote's name, once revealed.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub answer: Option<String>,
  /// The account that named the emote; absent when time ran out.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub winner: Option<String>,
  /// Points the winner earned this round.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub points: Option<u32>,
  /// Players by score, highest first.
  pub players: Vec<Score>,
  /// This round's most recent wrong guesses, oldest first.
  pub guesses: Vec<SharedGuess>,
  /// Why the last match could not start.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub notice: Option<&'static str>,
}

#[derive(Debug, Default)]
struct Player {
  score: u32,
  /// Open connections; a player who left keeps a scored row until the next match.
  seats: usize,
}

#[derive(Debug, Default)]
enum Phase {
  #[default]
  Lobby,
  Loading,
  Ready {
    answer: String,
    until: Instant,
  },
  Round {
    answer: String,
    started: Instant,
  },
  Reveal {
    answer: String,
    winner: Option<NonZeroU64>,
    points: u32,
    until: Instant,
  },
  Final,
}

#[derive(Debug, Default)]
struct State {
  players: HashMap<NonZeroU64, Player>,
  phase: Phase,
  round: usize,
  rounds: usize,
  notice: Option<&'static str>,
  image: Option<(String, Arc<Image>)>,
  guesses: VecDeque<(NonZeroU64, String)>,
  task: Option<JoinHandle<()>>,
}

/// One room's state and the version counter its connections watch.
#[derive(Debug)]
struct Room {
  key: RoomKey,
  state: Mutex<State>,
  changed: watch::Sender<u64>,
}

impl Room {
  fn new(key: RoomKey) -> Self {
    Self {
      key,
      state: Mutex::default(),
      changed: watch::Sender::new(0),
    }
  }

  fn lock(&self) -> MutexGuard<'_, State> {
    self.state.lock().unwrap_or_else(PoisonError::into_inner)
  }

  /// Tells every connection that the snapshot changed.
  fn publish(&self) {
    self
      .changed
      .send_modify(|version| *version = version.wrapping_add(1));
  }

  /// Adds one connection for `user`, or returns `false` when the room is full.
  fn sit(&self, user: NonZeroU64) -> bool {
    let mut state = self.lock();
    if !state.players.contains_key(&user) && state.players.len() >= MAX_PLAYERS {
      return false;
    }
    state.players.entry(user).or_default().seats += 1;
    drop(state);
    self.publish();
    true
  }

  /// Removes one connection for `user` and reports whether the room is now empty.
  ///
  /// An empty room's match is cancelled.
  fn leave(&self, user: NonZeroU64) -> bool {
    let mut state = self.lock();
    if let Some(player) = state.players.get_mut(&user) {
      player.seats = player.seats.saturating_sub(1);
      if player.seats == 0 && player.score == 0 {
        state.players.remove(&user);
      }
    }
    let empty = state.players.values().all(|player| player.seats == 0);
    if empty && let Some(task) = state.task.take() {
      task.abort();
    }
    drop(state);
    self.publish();
    empty
  }

  /// Moves a waiting room to loading and clears the last match's scores.
  fn open_match(&self) -> bool {
    let mut state = self.lock();
    if !matches!(state.phase, Phase::Lobby | Phase::Final) {
      return false;
    }
    state.phase = Phase::Loading;
    state.round = 0;
    state.rounds = 0;
    state.notice = None;
    state.image = None;
    state.guesses.clear();
    state.players.retain(|_, player| player.seats > 0);
    for player in state.players.values_mut() {
      player.score = 0;
    }
    drop(state);
    true
  }

  /// Publishes the round's image and holds the room in the ready beat.
  fn begin_round(&self, round: usize, rounds: usize, answer: String, image: Image) {
    let mut state = self.lock();
    state.round = round;
    state.rounds = rounds;
    state.image = Some((token(), Arc::new(image)));
    state.guesses.clear();
    state.phase = Phase::Ready {
      answer,
      until: Instant::now() + READY_TIME,
    };
    drop(state);
    self.publish();
  }

  /// Starts the round timer once the ready beat is over.
  fn start_guessing(&self) {
    let mut state = self.lock();
    let Phase::Ready { answer, .. } = &state.phase else {
      return;
    };
    state.phase = Phase::Round {
      answer: answer.clone(),
      started: Instant::now(),
    };
    drop(state);
    self.publish();
  }

  /// Scores the first matching guess and reveals the answer at once.
  ///
  /// A wrong guess is shared with the room, shortened and limited to the most recent few.
  /// A guess already on that list, from any player and in any letter case, is not added again.
  fn guess(&self, user: NonZeroU64, text: &str) -> Guess {
    let mut state = self.lock();
    let Phase::Round { answer, started } = &state.phase else {
      return Guess::Closed;
    };
    let text = text.trim();
    if text.to_lowercase() != answer.to_lowercase() {
      let shared: String = text.chars().take(MAX_SHARED_GUESS_CHARS).collect();
      let repeated = state
        .guesses
        .iter()
        .any(|(_, earlier)| earlier.to_lowercase() == shared.to_lowercase());
      if !shared.is_empty() && !repeated {
        if state.guesses.len() >= MAX_SHARED_GUESSES {
          state.guesses.pop_front();
        }
        state.guesses.push_back((user, shared));
        drop(state);
        self.publish();
      }
      return Guess::Wrong;
    }
    let answer = answer.clone();
    let points = points_after(started.elapsed());
    if let Some(player) = state.players.get_mut(&user) {
      player.score = player.score.saturating_add(points);
    }
    state.phase = Phase::Reveal {
      answer,
      winner: Some(user),
      points,
      until: Instant::now() + REVEAL_TIME,
    };
    drop(state);
    self.publish();
    Guess::Correct
  }

  /// Reveals the answer without a winner if the round is still open.
  fn time_up(&self) {
    let mut state = self.lock();
    let Phase::Round { answer, .. } = &state.phase else {
      return;
    };
    state.phase = Phase::Reveal {
      answer: answer.clone(),
      winner: None,
      points: 0,
      until: Instant::now() + REVEAL_TIME,
    };
    drop(state);
    self.publish();
  }

  /// When the current reveal ends; `None` outside the reveal phase.
  fn reveal_until(&self) -> Option<Instant> {
    match self.lock().phase {
      Phase::Reveal { until, .. } => Some(until),
      Phase::Lobby | Phase::Loading | Phase::Ready { .. } | Phase::Round { .. } | Phase::Final => {
        None
      }
    }
  }

  /// When the current ready beat ends; `None` outside it.
  fn ready_until(&self) -> Option<Instant> {
    match self.lock().phase {
      Phase::Ready { until, .. } => Some(until),
      Phase::Lobby | Phase::Loading | Phase::Round { .. } | Phase::Reveal { .. } | Phase::Final => {
        None
      }
    }
  }

  /// Ends the match: with a notice the room returns to the lobby, otherwise scores stay up.
  fn finish(&self, notice: Option<&'static str>) {
    let mut state = self.lock();
    state.phase = if notice.is_some() {
      Phase::Lobby
    } else {
      Phase::Final
    };
    state.notice = notice;
    state.image = None;
    state.guesses.clear();
    state.task = None;
    drop(state);
    self.publish();
  }

  fn image(&self, token: &str) -> Option<Arc<Image>> {
    let state = self.lock();
    let image = state
      .image
      .as_ref()
      .filter(|(current, _)| current == token)
      .map(|(_, image)| Arc::clone(image));
    drop(state);
    image
  }

  fn snapshot(&self) -> Snapshot {
    let state = self.lock();
    let now = Instant::now();
    let remaining = |until: Instant| Some(millis(until.saturating_duration_since(now)));
    let hint = match &state.phase {
      Phase::Round { answer, started } => {
        Some(masked(answer, now.saturating_duration_since(*started)))
      }
      Phase::Lobby | Phase::Loading | Phase::Ready { .. } | Phase::Reveal { .. } | Phase::Final => {
        None
      }
    };
    let (phase, remaining_ms, answer, winner, points) = match &state.phase {
      Phase::Lobby => ("lobby", None, None, None, None),
      Phase::Loading => ("loading", None, None, None, None),
      Phase::Ready { until, .. } => ("ready", remaining(*until), None, None, None),
      Phase::Round { started, .. } => ("round", remaining(*started + ROUND_TIME), None, None, None),
      Phase::Reveal {
        answer,
        winner,
        points,
        until,
      } => (
        "reveal",
        remaining(*until),
        Some(answer.clone()),
        winner.map(|id| id.to_string()),
        Some(*points),
      ),
      Phase::Final => ("final", None, None, None, None),
    };
    let mut players: Vec<_> = state
      .players
      .iter()
      .map(|(id, player)| (player.score, id.get()))
      .collect();
    players.sort_unstable_by(|left, right| right.0.cmp(&left.0).then(left.1.cmp(&right.1)));
    Snapshot {
      phase,
      round: state.round,
      rounds: state.rounds,
      image: state.image.as_ref().map(|(token, _)| token.clone()),
      remaining_ms,
      round_ms: millis(ROUND_TIME),
      hint,
      answer,
      winner,
      points,
      players: players
        .into_iter()
        .map(|(score, id)| Score {
          id: id.to_string(),
          score,
        })
        .collect(),
      guesses: state
        .guesses
        .iter()
        .map(|(id, text)| SharedGuess {
          id: id.to_string(),
          text: text.clone(),
        })
        .collect(),
      notice: state.notice,
    }
  }
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

  /// Picks this match's emotes in play order, with spares for failed downloads.
  ///
  /// The pool is the guild's individual additions and selected feeds without overlay
  /// emotes, one entry per case-insensitive name. Returns the number of rounds and the
  /// shuffled picks, or `None` when fewer than [`MIN_POOL`] emotes are eligible.
  ///
  /// # Errors
  ///
  /// Returns an error if saved guild state cannot be read.
  async fn game_pool(&self, guild: NonZeroU64) -> Result<Option<(usize, Vec<Emote>)>> {
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

  /// Downloads one emote's original bytes for a round.
  ///
  /// # Errors
  ///
  /// Returns an error for a missing image URL, a failed or slow download, or an image
  /// larger than the game keeps in memory.
  async fn round_image(&self, emote: &Emote) -> Result<Image> {
    let layer = Layer::emote_at(emote, IMAGE_SCALE).context("emote has no image")?;
    let image = tokio::time::timeout(
      IMAGE_DEADLINE,
      rendering::original(self.client.http(), &layer, self.games.cache.as_ref()),
    )
    .await??;
    anyhow::ensure!(
      image.bytes.len() <= MAX_IMAGE_BYTES,
      "round image is too large"
    );
    Ok(image)
  }

  /// Takes picks until one downloads, skipping emotes whose image is unavailable.
  async fn next_round(&self, picks: &mut impl Iterator<Item = Emote>) -> Option<(String, Image)> {
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

/// Plays one match, then leaves the final scores up until the next start.
async fn run_match(application: Arc<Application>, room: Arc<Room>) {
  let (rounds, picks) = match application.game_pool(room.key.0).await {
    Ok(Some(pool)) => pool,
    Ok(None) => return room.finish(Some(TOO_FEW_EMOTES)),
    Err(error) => {
      tracing::warn!(%error, message = "Could not load the game emote pool");
      return room.finish(Some(POOL_UNAVAILABLE));
    }
  };
  let mut picks = picks.into_iter();
  for round in 1..=rounds {
    let Some((answer, image)) = application.next_round(&mut picks).await else {
      return room.finish((round == 1).then_some(IMAGES_UNAVAILABLE));
    };
    room.begin_round(round, rounds, answer, image);
    play_round(&room).await;
  }
  room.finish(None);
}

/// Holds the ready beat, runs the round until a correct guess or its timer, then holds the
/// reveal on screen.
///
/// The room is republished when each hint letter appears, so every player sees it on time.
async fn play_round(room: &Room) {
  if let Some(until) = room.ready_until() {
    tokio::time::sleep_until(until).await;
  }
  room.start_guessing();
  let started = Instant::now();
  let mut changes = room.changed.subscribe();
  for moment in [FIRST_LETTER, SECOND_LETTER, ROUND_TIME] {
    if solved_before(room, &mut changes, started + moment).await {
      break;
    }
    if moment == ROUND_TIME {
      room.time_up();
    } else {
      room.publish();
    }
  }
  if let Some(until) = room.reveal_until() {
    tokio::time::sleep_until(until).await;
  }
}

/// Waits until `deadline` and reports whether the round ended first.
async fn solved_before(room: &Room, changes: &mut watch::Receiver<u64>, deadline: Instant) -> bool {
  let timer = tokio::time::sleep_until(deadline);
  tokio::pin!(timer);
  loop {
    tokio::select! {
      () = &mut timer => return false,
      update = changes.changed() => {
        if update.is_err() || room.reveal_until().is_some() {
          return true;
        }
      }
    }
  }
}

/// When the hint shows the name's first letter.
const FIRST_LETTER: Duration = Duration::from_secs(10);
/// When the hint shows a second letter from the middle of the name.
const SECOND_LETTER: Duration = Duration::from_secs(15);

/// Hides the name behind underscores and reveals letters as the round runs.
///
/// Whitespace is always shown. The first letter appears halfway through the round and the
/// middle letter at three quarters, but never more than a third of the name: names shorter
/// than three characters reveal nothing, and names shorter than six reveal one letter.
fn masked(answer: &str, elapsed: Duration) -> String {
  let length = answer.chars().count();
  let due = usize::from(elapsed >= FIRST_LETTER) + usize::from(elapsed >= SECOND_LETTER);
  let shown = due.min(length / 3);
  answer
    .chars()
    .enumerate()
    .map(|(index, letter)| {
      let revealed = (shown >= 1 && index == 0) || (shown >= 2 && index == length / 2);
      if revealed || letter.is_whitespace() {
        letter
      } else {
        '_'
      }
    })
    .collect()
}

/// Awards four points in the first quarter of a round, down to one in the last.
fn points_after(elapsed: Duration) -> u32 {
  let quarter = elapsed.as_millis().saturating_mul(4) / ROUND_TIME.as_millis().max(1);
  4_u32.saturating_sub(u32::try_from(quarter.min(3)).unwrap_or(3))
}

fn millis(duration: Duration) -> u64 {
  u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// Returns 64 unpredictable bits from the standard library's randomly keyed hasher.
///
/// Each [`RandomState`] is keyed from operating-system randomness, so the output cannot be
/// predicted without the key. It guards short-lived game tickets and image tokens only.
fn random() -> u64 {
  static COUNTER: AtomicU64 = AtomicU64::new(0);
  RandomState::new().hash_one(COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Returns a 128-bit random token as 32 hex digits.
fn token() -> String {
  format!("{:016x}{:016x}", random(), random())
}

/// Shuffles in place with a Fisher–Yates pass.
fn shuffle<T>(items: &mut [T]) {
  for index in (1..items.len()).rev() {
    let bound = u64::try_from(index).unwrap_or(u64::MAX).saturating_add(1);
    let other = usize::try_from(random() % bound).unwrap_or(0);
    items.swap(index, other);
  }
}

#[cfg(test)]
mod tests;
