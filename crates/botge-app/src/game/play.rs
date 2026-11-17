//! The background task that plays one match in a room.

use std::{num::NonZeroU64, sync::Arc, vec};

use anyhow::Result;
use botge_domain::emotes::Emote;
use botge_emotes::rendering::Image;
use tokio::{sync::watch, time::Instant};

use super::{FIRST_LETTER, ROUND_TIME, SECOND_LETTER, room::Room};

/// Where a match gets its emotes and their images.
///
/// The match task depends on this instead of the application, so it needs neither saved
/// guild state nor the network to run.
pub(super) trait Rounds: Send + Sync {
  /// Picks a guild's emotes in play order, with spares for images that fail to load.
  ///
  /// Returns the number of rounds and the picks, or `None` when the guild has too few
  /// eligible emotes.
  ///
  /// # Errors
  ///
  /// Returns an error if the guild's emotes cannot be read.
  fn pool(
    &self,
    guild: NonZeroU64,
  ) -> impl Future<Output = Result<Option<(usize, Vec<Emote>)>>> + Send;

  /// Takes picks until one has an image, and returns its name with that image.
  fn next(
    &self,
    picks: &mut vec::IntoIter<Emote>,
  ) -> impl Future<Output = Option<(String, Image)>> + Send;
}

pub(super) const TOO_FEW_EMOTES: &str =
  "This server needs at least 10 added or personal emotes to play. Add more and try again.";
pub(super) const POOL_UNAVAILABLE: &str = "Botge could not load this server's emotes. Try again.";
pub(super) const IMAGES_UNAVAILABLE: &str = "Botge could not load any emote images. Try again.";

/// Plays one match, then leaves the final scores up until the next start.
pub(super) async fn run_match(source: Arc<impl Rounds>, room: Arc<Room>) {
  let (rounds, picks) = match source.pool(room.key.0).await {
    Ok(Some(pool)) => pool,
    Ok(None) => return room.finish(Some(TOO_FEW_EMOTES)),
    Err(error) => {
      tracing::warn!(%error, message = "Could not load the game emote pool");
      return room.finish(Some(POOL_UNAVAILABLE));
    }
  };
  let mut picks = picks.into_iter();
  let mut notice = None;
  for round in 1..=rounds {
    // A match that runs out of images ends early; one that never showed any says why.
    let Some((answer, image)) = source.next(&mut picks).await else {
      notice = (round == 1).then_some(IMAGES_UNAVAILABLE);
      break;
    };
    room.begin_round(round, rounds, answer, image);
    play_round(&room).await;
  }
  room.finish(notice);
}

/// Holds the ready beat, runs the round until a correct guess or its timer, then holds the
/// reveal on screen.
///
/// The room is republished when each hint letter appears, so every player sees it on time.
pub(super) async fn play_round(room: &Room) {
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
pub(super) async fn solved_before(
  room: &Room,
  changes: &mut watch::Receiver<u64>,
  deadline: Instant,
) -> bool {
  let timer = tokio::time::sleep_until(deadline);
  tokio::pin!(timer);
  loop {
    tokio::select! {
      () = &mut timer => return false,
      // The room owns the sender, so the channel stays open for as long as this waits.
      Ok(()) = changes.changed() => {
        if room.reveal_until().is_some() {
          return true;
        }
      }
    }
  }
}
