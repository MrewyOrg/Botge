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
use std::sync::atomic::{AtomicIsize, Ordering};

use botge_domain::providers::Providers;
use botge_storage::Store;

use super::{
  play::{IMAGES_UNAVAILABLE, POOL_UNAVAILABLE, TOO_FEW_EMOTES, play_round},
  room::{MAX_PLAYERS, MAX_SHARED_GUESS_CHARS, MAX_SHARED_GUESSES, masked, points_after},
  *,
};
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

/// A guild with enough saved emotes to play, whose images come from a loopback server.
struct Playable {
  _directory: tempfile::TempDir,
  store: Arc<Store>,
  application: Arc<Application>,
  /// Image downloads the server still answers; later ones receive 404.
  images: Arc<AtomicIsize>,
  _server: botge_test_support::TestServer,
}

impl Playable {
  async fn new(emotes: usize, images: isize) -> Result<Self> {
    use axum::{Router, http::StatusCode, routing::get};
    let pixel = botge_test_support::png_pixel()?;
    let images = Arc::new(AtomicIsize::new(images));
    let remaining = Arc::clone(&images);
    let server = botge_test_support::TestServer::start(Router::new().route(
      "/7tv/emote/{id}/2x.png",
      get(move || {
        let served = remaining.fetch_sub(1, Ordering::Relaxed) > 0;
        let pixel = pixel.clone();
        async move {
          if served {
            Ok(pixel)
          } else {
            Err(StatusCode::NOT_FOUND)
          }
        }
      }),
    ))
    .await?;
    let directory = tempfile::tempdir()?;
    let store = Arc::new(Store::open(&directory.path().join("game.redb"))?);
    for index in 0..emotes {
      let emote = botge_test_support::example(&format!("Emote{index}"), &format!("{index:024x}"));
      assert!(store.add_emote(NonZeroU64::MIN, emote)?);
    }
    let mut application = Application::new(
      Providers {
        seven_added: true,
        ..Providers::default()
      },
      Arc::clone(&store),
      None,
    )?;
    application.set_game_cache(Some(server.origin.clone()));
    Ok(Self {
      _directory: directory,
      store,
      application: Arc::new(application),
      images,
      _server: server,
    })
  }

  async fn seat(&self) -> Result<Seat> {
    let issued = self
      .application
      .join_game(&Members, NonZeroU64::MIN, &credential(), "instance")
      .await?;
    self
      .application
      .take_seat(&issued.ticket)
      .context("the ticket was not redeemed")
  }
}

/// Hands out emotes named `Emote0`, `Emote1`, … in order, each with an image, without a
/// database or a network.
struct Scripted;

impl Rounds for Scripted {
  fn pool(
    &self,
    _guild: NonZeroU64,
  ) -> impl Future<Output = Result<Option<(usize, Vec<Emote>)>>> + Send {
    let picks = (0..ROUNDS)
      .map(|index| botge_test_support::example(&format!("Emote{index}"), &format!("{index:024x}")))
      .collect();
    std::future::ready(Ok(Some((ROUNDS, picks))))
  }

  fn next(
    &self,
    picks: &mut vec::IntoIter<Emote>,
  ) -> impl Future<Output = Option<(String, Image)>> + Send {
    std::future::ready(picks.next().map(|emote| (emote.name, image())))
  }
}

/// Waits until the room's snapshot satisfies `wanted`.
async fn until(room: &Room, wanted: impl Fn(&Snapshot) -> bool) -> Snapshot {
  let mut changes = room.changed.subscribe();
  loop {
    let snapshot = room.snapshot();
    if wanted(&snapshot) {
      return snapshot;
    }
    changes.changed().await.unwrap();
  }
}

/// Waits until the room reaches `phase` and returns what it shows then.
async fn reach(seat: &Seat, phase: &str) -> Snapshot {
  let mut changes = seat.changes();
  loop {
    let snapshot = seat.snapshot();
    if snapshot.phase == phase {
      return snapshot;
    }
    changes.changed().await.unwrap();
  }
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

#[tokio::test]
async fn picks_one_round_per_distinct_base_emote_with_spares() -> Result<()> {
  let playable = Playable::new(12, 0).await?;
  let mut overlay = botge_test_support::example("Overlay", &format!("{:024x}", 100));
  overlay.overlaying = true;
  let blank = botge_test_support::example("  ", &format!("{:024x}", 101));
  let mut elsewhere = botge_test_support::example("Elsewhere", &format!("{:024x}", 102));
  elsewhere.image = "https://example.com/emote.png".into();
  for unusable in [overlay, blank, elsewhere] {
    assert!(playable.store.add_emote(NonZeroU64::MIN, unusable)?);
  }
  let (rounds, picks) = playable
    .application
    .pool(NonZeroU64::MIN)
    .await?
    .context("the pool was too small")?;
  assert_eq!(rounds, ROUNDS);
  let mut names: Vec<_> = picks.iter().map(|emote| emote.name.as_str()).collect();
  names.sort_unstable();
  names.dedup();
  assert_eq!(names.len(), 12, "every base emote is a pick or a spare");
  assert!(names.iter().all(|name| name.starts_with("Emote")));

  let short = Playable::new(MIN_POOL - 1, 0).await?;
  assert!(short.application.pool(NonZeroU64::MIN).await?.is_none());
  Ok(())
}

#[tokio::test]
async fn plays_a_round_with_a_downloaded_image_and_ends_when_no_more_load() -> Result<()> {
  let playable = Playable::new(MIN_POOL, 1).await?;
  let seat = playable.seat().await?;
  assert!(seat.start());
  assert!(!seat.start(), "a loading match cannot be started again");
  let ready = tokio::time::timeout(Duration::from_secs(5), reach(&seat, "ready")).await?;
  assert_eq!((ready.round, ready.rounds), (1, MIN_POOL));
  let token = ready.image.context("the ready beat has no image")?;
  let image = playable
    .application
    .game_image(&token)
    .context("the round image is not served")?;
  assert_eq!(image.bytes, botge_test_support::png_pixel()?);
  assert_eq!(image.filename, "emote.png");
  assert_eq!(
    playable.images.load(Ordering::Relaxed),
    0,
    "one image was downloaded"
  );

  // From here the ready beat, the round and the reveal run on the paused clock.
  tokio::time::pause();
  reach(&seat, "round").await;
  let answer = (0..MIN_POOL)
    .map(|index| format!("Emote{index}"))
    .find(|name| seat.guess(name) == Guess::Correct)
    .context("no saved emote was the answer")?;
  assert_eq!(reach(&seat, "reveal").await.answer, Some(answer));
  // Every other image is unavailable, so the match ends after its first round.
  let last = reach(&seat, "final").await;
  assert!(last.notice.is_none());
  assert_eq!(last.players.first().map(|player| player.score), Some(4));
  Ok(())
}

#[tokio::test]
async fn returns_to_the_lobby_when_images_or_saved_emotes_cannot_be_loaded() -> Result<()> {
  let playable = Playable::new(MIN_POOL, 0).await?;
  let seat = playable.seat().await?;
  assert!(seat.start());
  let lobby = tokio::time::timeout(Duration::from_secs(5), async {
    loop {
      let lobby = reach(&seat, "lobby").await;
      if lobby.notice.is_some() {
        break lobby;
      }
      seat.changes().changed().await.unwrap();
    }
  })
  .await?;
  assert_eq!(lobby.notice, Some(IMAGES_UNAVAILABLE));

  playable.store.invalidate_table("guild_emotes")?;
  assert!(seat.start());
  let lobby = tokio::time::timeout(Duration::from_secs(5), async {
    loop {
      let lobby = reach(&seat, "lobby").await;
      if lobby.notice == Some(POOL_UNAVAILABLE) {
        break lobby;
      }
      seat.changes().changed().await.unwrap();
    }
  })
  .await?;
  assert_eq!(lobby.phase, "lobby");
  Ok(())
}

#[tokio::test]
async fn bounds_waiting_tickets_open_rooms_and_players_in_a_room() -> Result<()> {
  let (_directory, application) = application()?;
  let seat_for = |instance: &str, user: u64| {
    let ticket = token();
    application.games.tickets().insert(
      ticket.clone(),
      Ticket {
        key: (NonZeroU64::MIN, instance.into()),
        user: NonZeroU64::new(user).unwrap(),
        expires: Instant::now() + TICKET_LIFETIME,
      },
    );
    application.take_seat(&ticket)
  };
  let players: Vec<_> = (1..=MAX_PLAYERS)
    .map(|user| seat_for("full", u64::try_from(user).unwrap()))
    .collect();
  assert!(players.iter().all(Option::is_some));
  assert!(seat_for("full", 1000).is_none(), "the room is full");

  let rooms: Vec<_> = (1..MAX_ROOMS)
    .map(|room| seat_for(&format!("room{room}"), 1))
    .collect();
  assert!(rooms.iter().all(Option::is_some));
  assert!(seat_for("one-too-many", 1).is_none());
  drop(rooms);
  assert!(seat_for("one-too-many", 1).is_some());

  for _ in 0..MAX_TICKETS {
    application
      .join_game(&Members, NonZeroU64::MIN, &credential(), "instance")
      .await?;
  }
  let busy = application
    .join_game(&Members, NonZeroU64::MIN, &credential(), "instance")
    .await;
  assert!(matches!(busy, Err(AccessError(FailureKind::Conflict, _))));
  Ok(())
}

#[tokio::test]
async fn ignores_transitions_outside_their_phase_and_players_without_a_seat() {
  let room = Room::new((NonZeroU64::MIN, "instance".into()));
  assert!(room.sit(ALICE));
  assert!(
    !room.leave(BOB),
    "a stranger leaving does not empty the room"
  );
  room.start_guessing();
  room.time_up();
  assert!(room.ready_until().is_none());
  assert_eq!(room.snapshot().phase, "lobby");

  let room = room_with_round("Wave");
  room.start_guessing();
  assert!(room.ready_until().is_none());
  // A correct guess from a connection whose player row is gone still ends the round.
  assert_eq!(
    room.guess(NonZeroU64::new(3).unwrap(), "wave"),
    Guess::Correct
  );
  let revealed = room.snapshot();
  assert_eq!(revealed.winner.as_deref(), Some("3"));
  assert!(revealed.players.iter().all(|player| player.score == 0));
  room.time_up();
  assert_eq!(room.snapshot().phase, "reveal");
}

#[tokio::test(start_paused = true)]
async fn a_round_without_a_ready_beat_runs_its_timers_and_changes_nothing() {
  let room = Room::new((NonZeroU64::MIN, "instance".into()));
  let started = Instant::now();
  play_round(&room).await;
  assert_eq!(started.elapsed(), ROUND_TIME);
  assert_eq!(room.snapshot().phase, "lobby");
}

#[tokio::test(start_paused = true)]
async fn plays_every_round_in_order_and_ends_on_the_final_scoreboard() {
  let room = Arc::new(Room::new((NonZeroU64::MIN, "instance".into())));
  assert!(room.sit(ALICE) && room.sit(BOB));
  assert!(room.open_match());
  let started = Instant::now();
  let playing = tokio::spawn(run_match(Arc::new(Scripted), Arc::clone(&room)));

  // Alice names the first nine emotes at once; nobody names the last one.
  for round in 1..ROUNDS {
    let open = until(&room, |shown| {
      shown.phase == "round" && shown.round == round
    })
    .await;
    assert_eq!(open.rounds, ROUNDS);
    assert_eq!(
      room.guess(ALICE, &format!("Emote{}", round - 1)),
      Guess::Correct
    );
  }
  let unsolved = until(&room, |shown| {
    shown.phase == "reveal" && shown.round == ROUNDS
  })
  .await;
  assert_eq!(unsolved.answer.as_deref(), Some("Emote9"));
  assert!(unsolved.winner.is_none());

  playing.await.unwrap();
  let last = room.snapshot();
  assert_eq!(last.phase, "final");
  assert!(last.notice.is_none());
  let scores: Vec<_> = last
    .players
    .iter()
    .map(|player| (player.id.as_str(), player.score))
    .collect();
  assert_eq!(scores, [("1", 36), ("2", 0)]);
  // Nine solved rounds hold the ready beat and the reveal; the last also runs its timer out.
  let solved = (READY_TIME + REVEAL_TIME) * 9;
  assert_eq!(
    started.elapsed(),
    solved + READY_TIME + ROUND_TIME + REVEAL_TIME
  );
}
