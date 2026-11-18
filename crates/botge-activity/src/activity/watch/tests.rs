//! Exercises catalog watch tickets and change delivery through the Activity router.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::{
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
use super::{MAX_LIFETIME, session};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Opens the watch connection over loopback with optional proxy headers.
async fn connect(
  fixture: &Fixture,
  origin: &reqwest::Url,
  signed: bool,
) -> anyhow::Result<Result<Socket, StatusCode>> {
  let mut url = origin.join("catalog/ws")?;
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

/// The type of the next text message within `wait`, or `None` if nothing arrives.
async fn heard(socket: &mut Socket, wait: Duration) -> anyhow::Result<Option<String>> {
  let Ok(message) = tokio::time::timeout(wait, async {
    loop {
      if let Message::Text(body) = socket.next().await.context("connection closed")?? {
        let value: Value = serde_json::from_str(&body)?;
        return anyhow::Ok(value.get("type").and_then(Value::as_str).map(str::to_owned));
      }
    }
  })
  .await
  else {
    return Ok(None);
  };
  message
}

/// Connects and presents a fresh ticket for `code` in `guild`.
async fn watching(
  fixture: &Fixture,
  origin: &reqwest::Url,
  code: &str,
  guild: &str,
) -> anyhow::Result<Socket> {
  let (status, body) = fixture
    .post(
      "/catalog/watch",
      &json!({"guildId":guild,"code":code}),
      true,
    )
    .await?;
  assert_eq!(status, StatusCode::OK);
  let ticket = body
    .get("ticket")
    .and_then(Value::as_str)
    .context("missing ticket")?;
  let mut socket = connect(fixture, origin, true)
    .await?
    .map_err(|status| anyhow::anyhow!("upgrade failed: {status}"))?;
  socket
    .send(Message::text(
      json!({"type":"watch","ticket":ticket}).to_string(),
    ))
    .await?;
  assert_eq!(
    heard(&mut socket, Duration::from_secs(5)).await?.as_deref(),
    Some("watching")
  );
  Ok(socket)
}

/// Saves the default emote settings for `guild` as its administrator.
async fn save_settings(fixture: &Fixture, guild: &str) -> anyhow::Result<()> {
  let body = json!({"guildId":guild,"code":"admin","emotes":{}});
  let (status, _) = fixture.post("/settings/emotes", &body, true).await?;
  assert_eq!(status, StatusCode::OK);
  Ok(())
}

#[tokio::test]
async fn issues_watch_tickets_only_to_signed_members() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  for (signed, code, expected) in [
    (false, "member", StatusCode::UNAUTHORIZED),
    (true, "expired", StatusCode::UNAUTHORIZED),
    (true, "member", StatusCode::OK),
  ] {
    let body = json!({"guildId":"1","code":code});
    let (status, reply) = fixture.post("/catalog/watch", &body, signed).await?;
    assert_eq!(status, expected, "{code}");
    assert_eq!(
      reply.get("ticket").and_then(Value::as_str).map(str::len),
      (expected == StatusCode::OK).then_some(32)
    );
  }
  Ok(())
}

#[tokio::test]
async fn tells_open_catalogs_of_their_guild_when_to_reload() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let server = crate::tests::TestServer::start(fixture.router()).await?;
  assert_eq!(
    connect(&fixture, &server.origin, false).await?.err(),
    Some(StatusCode::UNAUTHORIZED)
  );
  // An unknown ticket is refused with an error message.
  let mut stranger = connect(&fixture, &server.origin, true)
    .await?
    .map_err(|status| anyhow::anyhow!("upgrade failed: {status}"))?;
  stranger
    .send(Message::text(
      json!({"type":"watch","ticket":"unknown"}).to_string(),
    ))
    .await?;
  assert_eq!(
    heard(&mut stranger, Duration::from_secs(5))
      .await?
      .as_deref(),
    Some("error")
  );

  let mut first = watching(&fixture, &server.origin, "member", "1").await?;
  let mut second = watching(&fixture, &server.origin, "member", "2").await?;
  save_settings(&fixture, "1").await?;
  assert_eq!(
    heard(&mut first, Duration::from_secs(5)).await?.as_deref(),
    Some("changed")
  );
  assert_eq!(heard(&mut second, Duration::from_millis(200)).await?, None);
  Ok(())
}

/// The browser's side of one in-memory watch session.
struct Peer {
  frames: mpsc::UnboundedSender<Result<Frame, axum::Error>>,
  seen: mpsc::UnboundedReceiver<Frame>,
  broken: Arc<AtomicBool>,
  session: JoinHandle<()>,
}

impl Peer {
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

  /// Presents a fresh ticket for a member of `guild`.
  async fn present(&self, fixture: &Fixture, guild: &str) -> anyhow::Result<()> {
    let (status, body) = fixture
      .post(
        "/catalog/watch",
        &json!({"guildId":guild,"code":"member"}),
        true,
      )
      .await?;
    assert_eq!(status, StatusCode::OK);
    let ticket = body
      .get("ticket")
      .and_then(Value::as_str)
      .context("missing ticket")?;
    self.say(&json!({"type":"watch","ticket":ticket}))
  }

  /// A watching peer that has heard the confirmation.
  async fn watching(fixture: &Fixture, guild: &str) -> anyhow::Result<Self> {
    let mut peer = Self::connect(&fixture.application);
    peer.present(fixture, guild).await?;
    peer.hear("watching").await?;
    Ok(peer)
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

  /// The next frame the session sends.
  async fn next(&mut self) -> anyhow::Result<Frame> {
    tokio::time::timeout(Duration::from_secs(5), self.seen.recv())
      .await?
      .context("the session ended")
  }

  /// Reads until a text message has the wanted type.
  async fn hear(&mut self, kind: &str) -> anyhow::Result<()> {
    loop {
      if let Frame::Text(body) = self.next().await? {
        let value: Value = serde_json::from_str(&body)?;
        if value.get("type").and_then(Value::as_str) == Some(kind) {
          return Ok(());
        }
      }
    }
  }

  async fn ended(self) -> anyhow::Result<()> {
    Ok(tokio::time::timeout(Duration::from_secs(5), self.session).await??)
  }
}

#[tokio::test(start_paused = true)]
async fn refuses_watchers_without_a_valid_first_message() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  for first in [
    Frame::Binary(vec![1].into()),
    Frame::Text("not json".into()),
    Frame::Text(
      json!({"type":"watch","ticket":"unknown"})
        .to_string()
        .into(),
    ),
  ] {
    let mut peer = Peer::connect(&fixture.application);
    peer.frame(first)?;
    peer.hear("error").await?;
    peer.ended().await?;
  }
  let mut failed = Peer::connect(&fixture.application);
  failed
    .frames
    .send(Err(axum::Error::new(std::io::Error::other("reset"))))?;
  failed.hear("error").await?;
  failed.ended().await?;

  let mut silent = Peer::connect(&fixture.application);
  tokio::time::sleep(JOIN_DEADLINE).await;
  silent.hear("error").await?;
  silent.ended().await?;

  // A browser that disconnects before presenting anything ends the session.
  let (frames, incoming) = mpsc::unbounded_channel();
  drop(frames);
  let (outgoing, _seen) = mpsc::unbounded_channel();
  let wire = Wire {
    incoming,
    outgoing,
    broken: Arc::new(AtomicBool::new(false)),
  };
  tokio::time::timeout(Duration::from_secs(5), session(wire, &fixture.application)).await?;
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn ends_when_a_delivery_fails() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  // The confirmation cannot be delivered.
  let unreachable = Peer::connect(&fixture.application);
  unreachable.broken.store(true, Ordering::Relaxed);
  unreachable.present(&fixture, "1").await?;
  unreachable.ended().await?;

  // A change cannot be delivered.
  let changed = Peer::watching(&fixture, "1").await?;
  changed.broken.store(true, Ordering::Relaxed);
  save_settings(&fixture, "1").await?;
  changed.ended().await?;

  // A ping cannot be delivered.
  let pinged = Peer::watching(&fixture, "1").await?;
  pinged.broken.store(true, Ordering::Relaxed);
  tokio::time::sleep(PING_INTERVAL).await;
  pinged.ended().await
}

#[tokio::test(start_paused = true)]
async fn answers_pings_and_closes_silent_or_talkative_peers() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut silent = Peer::watching(&fixture, "1").await?;
  save_settings(&fixture, "1").await?;
  silent.hear("changed").await?;
  tokio::time::sleep(PING_INTERVAL).await;
  assert!(matches!(silent.next().await?, Frame::Ping(_)));
  silent.frame(Frame::Pong(vec![].into()))?;
  // A ping from the browser is heard but needs no answer from the session.
  silent.frame(Frame::Ping(vec![].into()))?;
  tokio::time::sleep(SILENCE_LIMIT + PING_INTERVAL).await;
  silent.ended().await?;

  // The browser only presents its ticket; anything else ends the session.
  let talkative = Peer::watching(&fixture, "1").await?;
  talkative.say(&json!({"type":"watch","ticket":"again"}))?;
  talkative.ended().await
}

#[tokio::test(start_paused = true)]
async fn closes_after_its_lifetime_so_membership_is_checked_again() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let mut peer = Peer::watching(&fixture, "1").await?;
  tokio::time::sleep(MAX_LIFETIME).await;
  loop {
    match peer.next().await? {
      Frame::Close(_) => break,
      Frame::Ping(_) => {}
      other => anyhow::bail!("unexpected {other:?}"),
    }
  }
  peer.ended().await
}
