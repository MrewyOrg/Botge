//! Exercises round scoring, reveal timing, ticket redemption and room lifetime.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]
#![expect(
  clippy::unwrap_used,
  reason = "Fixture values are known to be present; a panic fails the scenario"
)]
use botge_domain::providers::Providers;
use botge_storage::Store;

use super::*;
use crate::access::{AccessToken, Membership, VoiceChannel};

const ALICE: NonZeroU64 = NonZeroU64::MIN;
const BOB: NonZeroU64 = NonZeroU64::new(2).unwrap();

/// Accepts members of the first guild and identifies every caller as Alice.
struct Members;

impl GuildAccess for Members {
  fn exchange_code(
    &self,
    _code: &str,
  ) -> impl Future<Output = Result<AccessToken, AccessError>> + Send {
    std::future::ready(Err(AccessError::UNAUTHORIZED))
  }

  fn user_id(
    &self,
    _credential: &Credential,
  ) -> impl Future<Output = Result<NonZeroU64, AccessError>> + Send {
    std::future::ready(Ok(ALICE))
  }

  fn membership(
    &self,
    guild: NonZeroU64,
    _credential: &Credential,
  ) -> impl Future<Output = Result<Membership, AccessError>> + Send {
    std::future::ready(if guild == NonZeroU64::MIN {
      Ok(Membership {
        administrator: false,
        roles: vec![],
        available_roles: vec![],
      })
    } else {
      Err(AccessError::NOT_MEMBER)
    })
  }

  fn voice_channels(
    &self,
    _guild: NonZeroU64,
    _credential: &Credential,
  ) -> impl Future<Output = Result<Vec<VoiceChannel>, AccessError>> + Send {
    std::future::ready(Err(AccessError::FORBIDDEN))
  }
}

fn image() -> Image {
  Image {
    bytes: vec![1, 2, 3],
    filename: "emote.png",
  }
}

fn room_in_ready_beat(answer: &str) -> Room {
  let room = Room::new((NonZeroU64::MIN, "instance".into()));
  assert!(room.sit(ALICE) && room.sit(BOB));
  assert!(room.open_match());
  room.begin_round(1, 2, answer.into(), image());
  room
}

fn room_with_round(answer: &str) -> Room {
  let room = room_in_ready_beat(answer);
  room.start_guessing();
  room
}

fn application() -> Result<(tempfile::TempDir, Arc<Application>)> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("game.redb"))?);
  Ok((
    directory,
    Arc::new(Application::new(Providers::default(), store, None)?),
  ))
}

fn credential() -> Credential {
  Credential::AccessToken("token".into())
}

#[tokio::test(start_paused = true)]
async fn scores_the_first_correct_guess_by_how_early_it_arrives() {
  let room = room_with_round("Wave");
  let hidden = room.snapshot();
  assert_eq!((hidden.phase, hidden.round, hidden.rounds), ("round", 1, 2));
  assert_eq!(hidden.remaining_ms, Some(20_000));
  assert!(hidden.answer.is_none() && hidden.winner.is_none());

  tokio::time::advance(Duration::from_secs(6)).await;
  assert_eq!(room.guess(BOB, "wav"), Guess::Wrong);
  assert_eq!(room.guess(BOB, "  wave "), Guess::Correct);
  assert_eq!(room.guess(ALICE, "Wave"), Guess::Closed);

  let revealed = room.snapshot();
  assert_eq!(revealed.phase, "reveal");
  assert_eq!(revealed.answer.as_deref(), Some("Wave"));
  assert_eq!(revealed.winner.as_deref(), Some("2"));
  assert_eq!(revealed.points, Some(3));
  assert_eq!(revealed.remaining_ms, Some(5000));
  let scores: Vec<_> = revealed
    .players
    .iter()
    .map(|player| (player.id.as_str(), player.score))
    .collect();
  assert_eq!(scores, [("2", 3), ("1", 0)]);
}

#[test]
fn awards_fewer_points_in_each_quarter_of_the_round() {
  let points = [0, 4999, 5000, 10_000, 15_000, 19_999, 60_000]
    .map(|elapsed| points_after(Duration::from_millis(elapsed)));
  assert_eq!(points, [4, 4, 3, 2, 1, 1, 1]);
}

#[tokio::test(start_paused = true)]
async fn reveals_without_a_winner_when_the_timer_ends_the_round() {
  let room = Arc::new(room_in_ready_beat("Clap"));
  let playing = tokio::spawn({
    let room = Arc::clone(&room);
    async move { play_round(&room).await }
  });
  tokio::time::sleep(Duration::from_secs(1)).await;
  let ready = room.snapshot();
  assert_eq!((ready.phase, ready.remaining_ms), ("ready", Some(2000)));
  assert!(ready.image.is_some() && ready.hint.is_none() && ready.answer.is_none());
  assert_eq!(room.guess(ALICE, "clap"), Guess::Closed);
  tokio::time::sleep(READY_TIME).await;
  let mut seen = vec![];
  for wait in [0, 9, 5] {
    tokio::time::sleep(Duration::from_secs(wait)).await;
    seen.push(room.snapshot().hint);
  }
  // The round is one second in; the first letter appears at ten seconds and stays alone
  // because a four-letter name reveals a single letter.
  assert_eq!(
    seen,
    [
      Some("____".into()),
      Some("C___".into()),
      Some("C___".into())
    ]
  );
  tokio::time::sleep(Duration::from_secs(5) + Duration::from_millis(1)).await;
  let revealed = room.snapshot();
  assert_eq!(revealed.phase, "reveal");
  assert_eq!(revealed.answer.as_deref(), Some("Clap"));
  assert!(revealed.winner.is_none());
  assert_eq!(revealed.points, Some(0));
  assert!(!playing.is_finished());
  tokio::time::sleep(REVEAL_TIME).await;
  playing.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_correct_guess_ends_the_round_before_its_timer() {
  let room = Arc::new(room_in_ready_beat("Clap"));
  let playing = tokio::spawn({
    let room = Arc::clone(&room);
    async move { play_round(&room).await }
  });
  tokio::time::sleep(READY_TIME + Duration::from_secs(1)).await;
  assert_eq!(room.guess(ALICE, "clap"), Guess::Correct);
  tokio::time::sleep(REVEAL_TIME + Duration::from_millis(1)).await;
  assert!(playing.is_finished());
  playing.await.unwrap();
}

#[tokio::test]
async fn serves_only_the_current_round_image_by_its_token() {
  let room = room_with_round("First");
  let first = room.snapshot().image.unwrap();
  assert_eq!(first.len(), 32);
  assert_eq!(room.image(&first).unwrap().bytes, [1, 2, 3]);
  assert!(room.image("First").is_none());
  room.begin_round(2, 2, "Second".into(), image());
  let second = room.snapshot().image.unwrap();
  assert_ne!(first, second);
  assert!(room.image(&first).is_none());
  room.finish(None);
  let finished = room.snapshot();
  assert_eq!(finished.phase, "final");
  assert!(finished.image.is_none() && room.image(&second).is_none());
}

#[tokio::test]
async fn keeps_a_scored_row_for_a_player_who_left_until_the_next_match() {
  let room = room_with_round("Clap");
  assert_eq!(room.guess(BOB, "clap"), Guess::Correct);
  assert!(!room.leave(BOB));
  assert_eq!(room.snapshot().players.len(), 2);
  room.finish(None);
  assert!(room.open_match());
  let lobby = room.snapshot();
  assert_eq!(lobby.phase, "loading");
  assert_eq!(lobby.players.len(), 1);
  assert!(!room.open_match(), "a loading match cannot start again");
  assert!(room.leave(ALICE));
}

#[tokio::test]
async fn rejects_players_beyond_the_room_limit() {
  let room = Room::new((NonZeroU64::MIN, "instance".into()));
  for id in 1..=MAX_PLAYERS {
    assert!(room.sit(NonZeroU64::new(u64::try_from(id).unwrap()).unwrap()));
  }
  assert!(!room.sit(NonZeroU64::new(1000).unwrap()));
  assert!(
    room.sit(ALICE),
    "a seated player can open another connection"
  );
}

#[tokio::test]
async fn denies_tickets_without_membership_or_a_valid_instance() -> Result<()> {
  let (_directory, application) = application()?;
  let outsider = NonZeroU64::new(9).unwrap();
  let denied = application
    .join_game(&Members, outsider, &credential(), "instance")
    .await;
  assert_eq!(denied.unwrap_err().0, FailureKind::PermissionDenied);
  for instance in ["", "has space", &"a".repeat(MAX_INSTANCE_LENGTH + 1)] {
    let invalid = application
      .join_game(&Members, NonZeroU64::MIN, &credential(), instance)
      .await;
    assert_eq!(invalid.unwrap_err().0, FailureKind::InvalidInput);
  }
  assert!(application.games.tickets().is_empty());
  assert!(application.take_seat("unknown").is_none());
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn redeems_a_ticket_once_and_closes_the_room_with_its_last_seat() -> Result<()> {
  let (_directory, application) = application()?;
  let join = || async {
    application
      .join_game(&Members, NonZeroU64::MIN, &credential(), "i-1-gc-2")
      .await
  };
  let issued = join().await?;
  assert_eq!(issued.user_id, "1");
  let seat = application.take_seat(&issued.ticket).unwrap();
  assert!(application.take_seat(&issued.ticket).is_none());
  let second = application.take_seat(&join().await?.ticket).unwrap();
  assert_eq!(application.games.rooms().len(), 1);
  assert_eq!(seat.snapshot().players.len(), 1);
  drop(second);
  assert_eq!(application.games.rooms().len(), 1);

  let expired = join().await?;
  tokio::time::advance(TICKET_LIFETIME).await;
  assert!(application.take_seat(&expired.ticket).is_none());

  drop(seat);
  assert!(application.games.rooms().is_empty());
  Ok(())
}

#[tokio::test]
async fn returns_to_the_lobby_with_a_notice_when_the_pool_is_too_small() -> Result<()> {
  let (_directory, application) = application()?;
  let issued = application
    .join_game(&Members, NonZeroU64::MIN, &credential(), "instance")
    .await?;
  let seat = application.take_seat(&issued.ticket).unwrap();
  let mut changes = seat.changes();
  assert!(seat.start());
  assert_eq!(seat.guess("anything"), Guess::Closed);
  let lobby = tokio::time::timeout(Duration::from_secs(5), async {
    loop {
      changes.changed().await.unwrap();
      let snapshot = seat.snapshot();
      if snapshot.phase == "lobby" {
        break snapshot;
      }
    }
  })
  .await?;
  assert_eq!(lobby.notice, Some(TOO_FEW_EMOTES));
  assert!(seat.start(), "the lobby can start another match");
  Ok(())
}

#[test]
fn shuffles_without_losing_items_and_makes_distinct_tokens() {
  let mut items: Vec<_> = (0..50).collect();
  shuffle(&mut items);
  items.sort_unstable();
  assert_eq!(items, (0..50).collect::<Vec<_>>());
  assert_ne!(token(), token());
}

#[test]
fn masks_the_name_and_reveals_at_most_a_third_of_it() {
  let at = |name: &str, seconds: u64| masked(name, Duration::from_secs(seconds));
  assert_eq!(at("Botge", 0), "_____");
  assert_eq!(at("Botge", 10), "B____");
  assert_eq!(at("Botge", 19), "B____");
  assert_eq!(at("Sleepy", 9), "______");
  assert_eq!(at("Sleepy", 10), "S_____");
  assert_eq!(at("Sleepy", 15), "S__e__");
  assert_eq!(at("Hi", 19), "__");
  assert_eq!(at("two words", 15), "t__ w____");
}

#[tokio::test]
async fn shares_recent_wrong_guesses_with_the_room_until_the_next_round() {
  let room = room_with_round("Wave");
  let mut changes = room.changed.subscribe();
  changes.mark_unchanged();
  assert_eq!(room.guess(ALICE, "   "), Guess::Wrong);
  assert!(
    !changes.has_changed().unwrap(),
    "a blank guess is not shared"
  );
  let long = "x".repeat(MAX_SHARED_GUESS_CHARS + 5);
  assert_eq!(room.guess(BOB, &long), Guess::Wrong);
  assert!(changes.has_changed().unwrap());
  // The same wrong name is listed once, whoever repeats it and in whatever case.
  assert_eq!(room.guess(ALICE, "Nope"), Guess::Wrong);
  changes.mark_unchanged();
  assert_eq!(room.guess(ALICE, "nope"), Guess::Wrong);
  assert_eq!(room.guess(BOB, " NOPE "), Guess::Wrong);
  assert!(!changes.has_changed().unwrap());
  assert_eq!(room.snapshot().guesses.len(), 2);
  for number in 0..MAX_SHARED_GUESSES {
    assert_eq!(room.guess(ALICE, &format!(" guess{number} ")), Guess::Wrong);
  }
  let shared: Vec<_> = room
    .snapshot()
    .guesses
    .into_iter()
    .map(|guess| (guess.id, guess.text))
    .collect();
  assert_eq!(shared.len(), MAX_SHARED_GUESSES);
  assert_eq!(shared.first(), Some(&("1".into(), "guess0".into())));
  assert_eq!(shared.last(), Some(&("1".into(), "guess7".into())));

  assert_eq!(room.guess(BOB, "wave"), Guess::Correct);
  assert_eq!(room.snapshot().guesses.len(), MAX_SHARED_GUESSES);
  room.begin_round(2, 2, "Next".into(), image());
  assert!(room.snapshot().guesses.is_empty());
}
