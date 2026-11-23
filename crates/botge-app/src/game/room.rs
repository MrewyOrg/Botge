//! One room's players, phases and scoring, and the snapshot each connection receives.

use std::{
  collections::{HashMap, VecDeque},
  num::NonZeroU64,
  sync::{Arc, Mutex, MutexGuard, PoisonError},
  time::Duration,
};

use botge_emotes::rendering::Image;
use serde::Serialize;
use tokio::{sync::watch, task::JoinHandle, time::Instant};

use super::{
  FIRST_LETTER, READY_TIME, REVEAL_TIME, ROUND_TIME, RoomKey, SECOND_LETTER, random::token,
};

/// Players one room accepts, counting players who left with a score.
pub(super) const MAX_PLAYERS: usize = 25;
/// Wrong guesses of the current round shared with the room; older ones drop off.
pub(super) const MAX_SHARED_GUESSES: usize = 8;
/// Characters of a wrong guess shared with the room.
pub(super) const MAX_SHARED_GUESS_CHARS: usize = 40;

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
pub(super) struct Player {
  score: u32,
  /// Open connections; a player who left keeps a scored row until the next match.
  seats: usize,
}

#[derive(Debug, Default)]
pub(super) enum Phase {
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
pub(super) struct State {
  players: HashMap<NonZeroU64, Player>,
  phase: Phase,
  round: usize,
  rounds: usize,
  notice: Option<&'static str>,
  image: Option<(String, Arc<Image>)>,
  guesses: VecDeque<(NonZeroU64, String)>,
  pub(super) task: Option<JoinHandle<()>>,
}

impl State {
  /// Moves a waiting room to loading and clears the last match's scores.
  pub(super) fn open_match(&mut self) -> bool {
    if !matches!(self.phase, Phase::Lobby | Phase::Final) {
      return false;
    }
    self.phase = Phase::Loading;
    self.round = 0;
    self.rounds = 0;
    self.notice = None;
    self.image = None;
    self.guesses.clear();
    self.players.retain(|_, player| player.seats > 0);
    for player in self.players.values_mut() {
      player.score = 0;
    }
    true
  }
}

/// One room's state and the version counter its connections watch.
#[derive(Debug)]
pub(super) struct Room {
  pub(super) key: RoomKey,
  state: Mutex<State>,
  pub(super) changed: watch::Sender<u64>,
}

impl Room {
  pub(super) fn new(key: RoomKey) -> Self {
    Self {
      key,
      state: Mutex::default(),
      changed: watch::Sender::new(0),
    }
  }

  pub(super) fn lock(&self) -> MutexGuard<'_, State> {
    self.state.lock().unwrap_or_else(PoisonError::into_inner)
  }

  /// Tells every connection that the snapshot changed.
  pub(super) fn publish(&self) {
    self
      .changed
      .send_modify(|version| *version = version.wrapping_add(1));
  }

  /// Adds one connection for `user`, or returns `false` when the room is full.
  pub(super) fn sit(&self, user: NonZeroU64) -> bool {
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
  pub(super) fn leave(&self, user: NonZeroU64) -> bool {
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

  /// Starts a waiting room's match and records its cancellation handle before it can finish.
  pub(super) fn start_match(&self, task: impl Future<Output = ()> + Send + 'static) -> bool {
    let mut state = self.lock();
    if !state.open_match() {
      return false;
    }
    // Tokio's spawn never polls synchronously. A running match must take this lock to finish.
    state.task = Some(tokio::spawn(task));
    drop(state);
    self.publish();
    true
  }

  /// Publishes the round's image and holds the room in the ready beat.
  pub(super) fn begin_round(&self, round: usize, rounds: usize, answer: String, image: Image) {
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
  pub(super) fn start_guessing(&self) {
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
  pub(super) fn guess(&self, user: NonZeroU64, text: &str) -> Guess {
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
  pub(super) fn time_up(&self) {
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
  pub(super) fn reveal_until(&self) -> Option<Instant> {
    match self.lock().phase {
      Phase::Reveal { until, .. } => Some(until),
      Phase::Lobby | Phase::Loading | Phase::Ready { .. } | Phase::Round { .. } | Phase::Final => {
        None
      }
    }
  }

  /// When the current ready beat ends; `None` outside it.
  pub(super) fn ready_until(&self) -> Option<Instant> {
    match self.lock().phase {
      Phase::Ready { until, .. } => Some(until),
      Phase::Lobby | Phase::Loading | Phase::Round { .. } | Phase::Reveal { .. } | Phase::Final => {
        None
      }
    }
  }

  /// Ends the match: with a notice the room returns to the lobby, otherwise scores stay up.
  pub(super) fn finish(&self, notice: Option<&'static str>) {
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

  pub(super) fn image(&self, token: &str) -> Option<Arc<Image>> {
    let state = self.lock();
    let image = state
      .image
      .as_ref()
      .filter(|(current, _)| current == token)
      .map(|(_, image)| Arc::clone(image));
    drop(state);
    image
  }

  pub(super) fn snapshot(&self) -> Snapshot {
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

/// Hides the name behind underscores and reveals letters as the round runs.
///
/// Whitespace is always shown. The first letter appears halfway through the round and the
/// middle letter at three quarters, but never more than a third of the name: names shorter
/// than three characters reveal nothing, and names shorter than six reveal one letter.
pub(super) fn masked(answer: &str, elapsed: Duration) -> String {
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
pub(super) fn points_after(elapsed: Duration) -> u32 {
  let quarter = elapsed.as_millis().saturating_mul(4) / ROUND_TIME.as_millis().max(1);
  4_u32.saturating_sub(u32::try_from(quarter.min(3)).unwrap_or(3))
}

pub(super) fn millis(duration: Duration) -> u64 {
  u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}
