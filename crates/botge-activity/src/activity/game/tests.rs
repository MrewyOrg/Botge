//! Exercises the game ticket, connection, and image routes through the Activity router.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::time::Duration;

use anyhow::Context as _;
use axum::http::StatusCode;
use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::{Value, json};
use tokio::net::TcpStream;
use tokio_tungstenite::{
  MaybeTlsStream, WebSocketStream, connect_async,
  tungstenite::{Message, client::IntoClientRequest as _},
};

use super::super::tests::Fixture;

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
