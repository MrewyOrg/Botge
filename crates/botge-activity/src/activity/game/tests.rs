//! Exercises the game ticket, connection, and image routes through the Activity router.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::{
  num::NonZeroU64,
  sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
  },
  time::Duration,
};

use anyhow::Context as _;
use axum::http::StatusCode;
use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio_tungstenite::{
  MaybeTlsStream, WebSocketStream, connect_async,
  tungstenite::{Message, client::IntoClientRequest as _},
};

use axum::extract::ws::Message as Frame;
use botge_app::Application;
use tokio::{sync::mpsc, task::JoinHandle};

use super::super::socket::{JOIN_DEADLINE, PING_INTERVAL, SILENCE_LIMIT};
use super::super::tests::{Fixture, Wire};
use super::{GUESS_INTERVAL, MAX_GUESS_BYTES, content_type, session};

/// The browser's side of one in-memory session.
struct Player {
  frames: mpsc::UnboundedSender<Result<Frame, axum::Error>>,
  seen: mpsc::UnboundedReceiver<Frame>,
  broken: Arc<AtomicBool>,
  session: JoinHandle<()>,
}

impl Player {
  fn connect(application: &Arc<Application>) -> Self {
    let (frames, incoming) = mpsc::unbounded_channel();
    let (outgoing, seen) = mpsc::unbounded_channel();
    let broken = Arc::new(AtomicBool::new(false));
    let wire = Wire {
      incoming,
      outgoing,
      broken: Arc::clone(&broken),
    };
    let application = Arc::clone(application);
    Self {
      frames,
      seen,
      broken,
      session: tokio::spawn(async move { session(wire, &application).await }),
    }
  }

  /// Connects and presents a fresh ticket for the fixture's `code`.
  async fn seated(fixture: &Fixture, code: &str) -> anyhow::Result<Self> {
    let player = Self::connect(&fixture.application);
    player.say(&json!({"type":"join","ticket":ticket(fixture, code).await?}))?;
    Ok(player)
  }

  fn frame(&self, frame: Frame) -> anyhow::Result<()> {
    self
      .frames
      .send(Ok(frame))
      .map_err(|_closed| anyhow::anyhow!("the session has ended"))
  }

  fn say(&self, value: &Value) -> anyhow::Result<()> {
    self.frame(Frame::Text(value.to_string().into()))
  }

  /// Reads until a message has the wanted type and room phase.
  async fn hear(&mut self, kind: &str, phase: Option<&str>) -> anyhow::Result<Value> {
    tokio::time::timeout(Duration::from_secs(5), async {
      loop {
        let Frame::Text(body) = self.seen.recv().await.context("the session ended")? else {
          continue;
        };
        let value: Value = serde_json::from_str(&body)?;
        if at(&value, "/type") == kind
          && phase.is_none_or(|phase| at(&value, "/state/phase") == phase)
        {
          return Ok(value);
        }
      }
    })
    .await?
  }

  /// Waits for the session to close the connection on its own.
  async fn ended(self) -> anyhow::Result<()> {
    Ok(tokio::time::timeout(Duration::from_secs(5), self.session).await??)
  }
}

/// Reads a JSON pointer, treating a missing value as null.
fn at<'a>(value: &'a Value, pointer: &str) -> &'a Value {
  value.pointer(pointer).unwrap_or(&Value::Null)
}

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Opens the room connection over loopback with optional proxy headers.
async fn connect(
  fixture: &Fixture,
  origin: &reqwest::Url,
  signed: bool,
) -> anyhow::Result<Result<Socket, StatusCode>> {
  let mut url = origin.join("game/ws")?;
  url
    .set_scheme("ws")
    .map_err(|()| anyhow::anyhow!("fixture origin cannot use ws"))?;
  let mut request = url.as_str().into_client_request()?;
  if signed {
    for (name, value) in fixture.signature()? {
      request.headers_mut().insert(name, value.parse()?);
    }
  }
  match connect_async(request).await {
    Ok((socket, _)) => Ok(Ok(socket)),
    Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
      Ok(Err(StatusCode::from_u16(response.status().as_u16())?))
    }
    Err(error) => Err(error.into()),
  }
}

/// Reads server messages until one has the wanted type and room phase.
async fn next(socket: &mut Socket, kind: &str, phase: Option<&str>) -> anyhow::Result<Value> {
  tokio::time::timeout(Duration::from_secs(5), async {
    loop {
      let message = socket.next().await.context("connection closed")??;
      let Message::Text(body) = message else {
        continue;
      };
      let value: Value = serde_json::from_str(&body)?;
      if at(&value, "/type") == kind
        && phase.is_none_or(|phase| at(&value, "/state/phase") == phase)
      {
        return Ok(value);
      }
    }
  })
  .await?
}

async fn ticket(fixture: &Fixture, code: &str) -> anyhow::Result<String> {
  let request = json!({"guildId":"1","code":code,"instanceId":"i-1-gc-1-2"});
  let (status, body) = fixture.post("/game/join", &request, true).await?;
  assert_eq!(status, StatusCode::OK);
  Ok(
    at(&body, "/ticket")
      .as_str()
      .context("missing ticket")?
      .to_owned(),
  )
}

#[tokio::test]
async fn issues_tickets_only_to_signed_members_with_a_valid_instance() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  for (signed, code, instance, expected) in [
    (false, "member", "i-1", StatusCode::UNAUTHORIZED),
    (true, "expired", "i-1", StatusCode::UNAUTHORIZED),
    (true, "member", "", StatusCode::BAD_REQUEST),
    (true, "member", "not valid", StatusCode::BAD_REQUEST),
    (true, "member", "i-1", StatusCode::OK),
  ] {
    let request = json!({"guildId":"1","code":code,"instanceId":instance});
    let (status, body) = fixture.post("/game/join", &request, signed).await?;
    assert_eq!(status, expected, "{code} {instance}");
    assert_eq!(at(&body, "/ticket").is_string(), expected == StatusCode::OK);
    if expected == StatusCode::OK {
      assert_eq!(at(&body, "/userId"), &json!(u64::MAX.to_string()));
      assert_eq!(at(&body, "/ticket").as_str().map(str::len), Some(32));
    }
  }
  Ok(())
}

#[tokio::test]
async fn serves_round_images_only_to_signed_requests_with_a_live_token() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let path = "/game/image/0123456789abcdef0123456789abcdef";
  assert_eq!(fixture.get(path, false).await?.0, StatusCode::UNAUTHORIZED);
  assert_eq!(fixture.get(path, true).await?.0, StatusCode::NOT_FOUND);
  Ok(())
}

#[tokio::test]
async fn seats_ticket_holders_and_shares_one_room_between_connections() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let server = crate::tests::TestServer::start(fixture.router()).await?;
  assert_eq!(
    connect(&fixture, &server.origin, false).await?.err(),
    Some(StatusCode::UNAUTHORIZED)
  );

  let mut stranger = connect(&fixture, &server.origin, true)
    .await?
    .map_err(|status| anyhow::anyhow!("upgrade failed: {status}"))?;
  stranger
    .send(Message::text(
      json!({"type":"join","ticket":"unknown"}).to_string(),
    ))
    .await?;
  next(&mut stranger, "error", None).await?;

  let admin_ticket = ticket(&fixture, "admin").await?;
  let mut admin = connect(&fixture, &server.origin, true)
    .await?
    .map_err(|status| anyhow::anyhow!("upgrade failed: {status}"))?;
  let join = json!({"type":"join","ticket":admin_ticket}).to_string();
  admin.send(Message::text(join.clone())).await?;
  let lobby = next(&mut admin, "state", Some("lobby")).await?;
  assert_eq!(at(&lobby, "/state/players"), &json!([{"id":"1","score":0}]));
  assert_eq!(at(&lobby, "/state/roundMs"), 20_000);

  // A used ticket cannot seat a second connection.
  let mut replay = connect(&fixture, &server.origin, true)
    .await?
    .map_err(|status| anyhow::anyhow!("upgrade failed: {status}"))?;
  replay.send(Message::text(join)).await?;
  next(&mut replay, "error", None).await?;

  let member_ticket = ticket(&fixture, "member").await?;
  let mut member = connect(&fixture, &server.origin, true)
    .await?
    .map_err(|status| anyhow::anyhow!("upgrade failed: {status}"))?;
  member
    .send(Message::text(
      json!({"type":"join","ticket":member_ticket}).to_string(),
    ))
    .await?;
  next(&mut member, "state", Some("lobby")).await?;
  let joined = next(&mut admin, "state", Some("lobby")).await?;
  assert_eq!(
    at(&joined, "/state/players").as_array().map(Vec::len),
    Some(2)
  );

  // This guild has no eligible emotes, so the match reports why it cannot start.
  member
    .send(Message::text(json!({"type":"start"}).to_string()))
    .await?;
  let notice = loop {
    let state = next(&mut admin, "state", Some("lobby")).await?;
    if at(&state, "/state/notice").is_string() {
      break state;
    }
  };
  assert!(
    at(&notice, "/state/notice")
      .as_str()
      .is_some_and(|notice| notice.contains("at least 10"))
  );

  drop(member);
  let alone = loop {
    let state = next(&mut admin, "state", Some("lobby")).await?;
    if at(&state, "/state/players").as_array().map(Vec::len) == Some(1) {
      break state;
    }
  };
  assert_eq!(at(&alone, "/state/players/0/id"), "1");
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn refuses_connections_that_do_not_present_a_ticket_first() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  for first in [
    Frame::Binary(vec![1].into()),
    Frame::Text(json!({"type":"start"}).to_string().into()),
    Frame::Text("not json".into()),
  ] {
    let mut player = Player::connect(&fixture.application);
    player.frame(first)?;
    player.hear("error", None).await?;
    player.ended().await?;
  }

  let mut failed = Player::connect(&fixture.application);
  failed
    .frames
    .send(Err(axum::Error::new(std::io::Error::other("reset"))))?;
  failed.hear("error", None).await?;
  failed.ended().await?;

  let mut silent = Player::connect(&fixture.application);
  tokio::time::sleep(JOIN_DEADLINE).await;
  silent.hear("error", None).await?;
  silent.ended().await?;

  // A peer that is already gone cannot be told why it was refused.
  let gone = Player::connect(&fixture.application);
  gone.broken.store(true, Ordering::Relaxed);
  gone.frame(Frame::Close(None))?;
  gone.ended().await
}

#[tokio::test(start_paused = true)]
async fn keeps_a_seat_through_stray_frames_and_closes_on_protocol_errors() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut player = Player::seated(&fixture, "admin").await?;
  player.hear("state", Some("lobby")).await?;
  player.frame(Frame::Binary(vec![1].into()))?;
  player.frame(Frame::Pong(vec![].into()))?;
  // No round is open, so a guess is neither right nor wrong and nothing is sent back.
  player.say(&json!({"type":"guess","text":"Wave"}))?;
  tokio::time::sleep(PING_INTERVAL).await;
  let mut pings = 0;
  while let Ok(frame) = player.seen.try_recv() {
    assert!(matches!(frame, Frame::Ping(_)), "unexpected {frame:?}");
    pings += 1;
  }
  assert_eq!(
    pings, 1,
    "one ping per interval after the one sent on connecting"
  );
  player.frame(Frame::Close(None))?;
  player.ended().await?;

  for last in [
    json!({"type":"join","ticket":"again"}),
    json!({"type":"dance"}),
  ] {
    let mut player = Player::seated(&fixture, "admin").await?;
    player.hear("state", Some("lobby")).await?;
    player.say(&last)?;
    player.ended().await?;
  }

  let mut hung_up = Player::seated(&fixture, "admin").await?;
  hung_up.hear("state", Some("lobby")).await?;
  let Player {
    frames, session, ..
  } = hung_up;
  drop(frames);
  tokio::time::timeout(Duration::from_secs(5), session).await??;
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn closes_a_connection_that_stops_answering_pings() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut watcher = Player::seated(&fixture, "member").await?;
  watcher.hear("state", Some("lobby")).await?;
  let mut silent = Player::seated(&fixture, "admin").await?;
  silent.hear("state", Some("lobby")).await?;
  watcher.hear("state", Some("lobby")).await?;

  // A player who keeps answering stays connected well past the silence limit.
  for _ in 0..4 {
    silent.frame(Frame::Pong(vec![].into()))?;
    tokio::time::sleep(PING_INTERVAL).await;
  }
  assert!(!silent.session.is_finished());

  // Then the phone suspends the app: no answers, and no close either.
  tokio::time::sleep(SILENCE_LIMIT + PING_INTERVAL).await;
  let room = loop {
    let state = watcher.hear("state", Some("lobby")).await?;
    if at(&state, "/state/players").as_array().map(Vec::len) == Some(1) {
      break state;
    }
  };
  // The silent admin (user 1) left; the watcher keeps the room.
  assert_ne!(at(&room, "/state/players/0/id"), "1");
  silent.ended().await
}

#[tokio::test(start_paused = true)]
async fn keeps_a_connection_whose_ping_answers_never_arrive() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut player = Player::seated(&fixture, "admin").await?;
  player.hear("state", Some("lobby")).await?;
  // Without a first answer the silence is the route's, not the player's.
  tokio::time::sleep(SILENCE_LIMIT * 3).await;
  assert!(!player.session.is_finished());
  player.frame(Frame::Close(None))?;
  player.ended().await
}

#[tokio::test(start_paused = true)]
async fn closes_a_seated_connection_when_a_delivery_fails() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  // The first room state cannot be delivered.
  let unreachable = Player::connect(&fixture.application);
  unreachable.broken.store(true, Ordering::Relaxed);
  unreachable.say(&json!({"type":"join","ticket":ticket(&fixture, "admin").await?}))?;
  unreachable.ended().await?;

  // A later room state cannot be delivered.
  let mut watcher = Player::seated(&fixture, "admin").await?;
  watcher.hear("state", Some("lobby")).await?;
  watcher.broken.store(true, Ordering::Relaxed);
  let mut member = Player::seated(&fixture, "member").await?;
  member.hear("state", Some("lobby")).await?;
  watcher.ended().await?;

  // A keep-alive ping cannot be delivered.
  member.broken.store(true, Ordering::Relaxed);
  tokio::time::sleep(PING_INTERVAL).await;
  member.ended().await
}

#[tokio::test]
async fn serves_the_round_image_and_answers_paced_guesses() -> anyhow::Result<()> {
  use axum::{Router, routing::get};
  let pixel = botge_test_support::png_pixel()?;
  let served = pixel.clone();
  let upstream = crate::tests::TestServer::start(Router::new().route(
    "/7tv/emote/{id}/2x.png",
    get(move || {
      let served = served.clone();
      async move { served }
    }),
  ))
  .await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  for index in 0..botge_app::game::MIN_POOL {
    let emote = botge_test_support::example(&format!("Emote{index}"), &format!("{index:024x}"));
    assert!(fixture.store.add_emote(NonZeroU64::MIN, emote)?);
  }
  let mut player = Player::seated(&fixture, "admin").await?;
  player.say(&json!({"type":"start"}))?;
  let ready = player.hear("state", Some("ready")).await?;
  let token = at(&ready, "/state/image").as_str().context("no image")?;
  let (status, kind, body) = fixture.get(&format!("/game/image/{token}"), true).await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(kind.as_deref(), Some("image/png"));
  assert_eq!(body, pixel);

  // The ready beat and the pacing between guesses run on the paused clock.
  tokio::time::pause();
  player.hear("state", Some("round")).await?;
  let wrong = json!({"type":"guess","text":"not an emote"});
  player.say(&wrong)?;
  player.hear("wrong", None).await?;
  // A guess sent too soon and an oversized guess are dropped without an answer.
  player.say(&wrong)?;
  tokio::time::sleep(GUESS_INTERVAL).await;
  player.say(&json!({"type":"guess","text":"x".repeat(MAX_GUESS_BYTES + 1)}))?;
  player.say(&wrong)?;
  player.hear("wrong", None).await?;
  assert!(
    player.seen.try_recv().is_err(),
    "only two guesses were answered"
  );

  tokio::time::sleep(GUESS_INTERVAL).await;
  player.broken.store(true, Ordering::Relaxed);
  player.say(&wrong)?;
  player.ended().await
}

#[test]
fn names_the_media_type_of_each_round_image_format() {
  let kinds = ["emote.gif", "emote.jpg", "emote.webp", "emote.png"].map(content_type);
  assert_eq!(
    kinds,
    ["image/gif", "image/jpeg", "image/webp", "image/png"]
  );
}

#[tokio::test]
async fn refuses_a_connection_when_every_socket_slot_is_taken() -> anyhow::Result<()> {
  use axum::{Router, routing::get};
  let fixture = Fixture::new()?;
  let mut state = fixture.state()?;
  state.sockets = Arc::new(tokio::sync::Semaphore::new(0));
  let router = Router::new()
    .route("/game/ws", get(super::connect))
    .with_state(Arc::new(state));
  let server = crate::tests::TestServer::start(router).await?;
  assert_eq!(
    connect(&fixture, &server.origin, true).await?.err(),
    Some(StatusCode::SERVICE_UNAVAILABLE)
  );
  Ok(())
}
