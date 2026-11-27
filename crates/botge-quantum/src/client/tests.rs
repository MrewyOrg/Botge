//! Exercises the sidecar client against loopback servers for every status and body outcome.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use std::sync::{Arc, Mutex};

use anyhow::Result;
use axum::{
  Json, Router,
  http::{HeaderMap, StatusCode as AxumStatus},
  routing::post,
};
use botge_test_support::{TestLogs, TestServer};
use serde_json::{Value, json};
use tokio::{
  io::{AsyncReadExt as _, AsyncWriteExt as _},
  net::TcpListener,
};

use super::*;
use crate::Steps;

const SAMPLE: (u32, u32, u32) = (3, 2, 1);

fn request() -> EntangleRequest {
  EntangleRequest {
    base_pool_size: 3,
    overlay_pool_size: 2,
    steps: Steps::try_from(4).unwrap_or_default(),
  }
}

fn indices(sample: Sample) -> (u32, u32, u32) {
  (sample.qubits, sample.base_index, sample.overlay_index)
}

/// Records each request's body and `Authorization` header, then answers with `status` and `body`.
async fn sidecar(
  status: u16,
  body: String,
) -> Result<(TestServer, Arc<Mutex<Vec<(Value, Option<String>)>>>)> {
  let seen = Arc::new(Mutex::new(Vec::new()));
  let log = Arc::clone(&seen);
  let router = Router::new().route(
    "/v1/entangle",
    post(move |headers: HeaderMap, Json(request): Json<Value>| {
      let log = Arc::clone(&log);
      let body = body.clone();
      async move {
        let authorization = headers
          .get("authorization")
          .and_then(|value| value.to_str().ok())
          .map(str::to_owned);
        if let Ok(mut log) = log.lock() {
          log.push((request, authorization));
        }
        (
          AxumStatus::from_u16(status).unwrap_or(AxumStatus::IM_A_TEAPOT),
          body,
        )
      }
    }),
  );
  Ok((TestServer::start(router).await?, seen))
}

fn sample_body() -> String {
  json!({"mode": "entangle", "qubits": 3, "base_index": 2, "overlay_index": 1}).to_string()
}

#[tokio::test]
async fn posts_the_request_with_an_optional_bearer_secret() -> Result<()> {
  let (server, seen) = sidecar(200, sample_body()).await?;
  let open = QuantumClient::new(&server.origin, None)?;
  let sample = open.entangle(&request()).await;
  assert_eq!(sample.map(indices), Ok(SAMPLE));
  let secured = QuantumClient::new(&server.origin, Secret::new("hunter2"))?;
  assert_eq!(secured.entangle(&request()).await.map(indices), Ok(SAMPLE));
  let seen = seen
    .lock()
    .map_err(|_error| anyhow::anyhow!("poisoned"))?
    .clone();
  let body = json!({"base_pool_size": 3, "overlay_pool_size": 2, "steps": 4});
  assert_eq!(
    seen,
    [
      (body.clone(), None),
      (body, Some("Bearer hunter2".to_owned()))
    ]
  );
  assert!(!format!("{secured:?}").contains("hunter2"));
  Ok(())
}

#[tokio::test]
async fn maps_error_statuses_without_retrying() -> Result<()> {
  let logs = TestLogs::default();
  let _logging = tracing::subscriber::set_default(logs.subscriber());
  let exhausted = json!({"detail": EXHAUSTED_DETAIL}).to_string();
  let other = json!({"detail": "upstream restarting"}).to_string();
  for (status, body, expected) in [
    (401, "{}".to_owned(), QuantumError::Refused),
    (422, "{}".to_owned(), QuantumError::Refused),
    (503, exhausted, QuantumError::Exhausted),
    (503, other, QuantumError::Unavailable),
    (503, "{}".to_owned(), QuantumError::Unavailable),
    (
      503,
      " ".repeat(MAX_BODY_BYTES + 1),
      QuantumError::Unavailable,
    ),
    (500, "{}".to_owned(), QuantumError::Unavailable),
    (302, "{}".to_owned(), QuantumError::Unavailable),
  ] {
    let (server, seen) = sidecar(status, body).await?;
    let client = QuantumClient::new(&server.origin, Secret::new("hunter2"))?;
    assert_eq!(client.entangle(&request()).await, Err(expected), "{status}");
    assert_eq!(
      seen
        .lock()
        .map_err(|_error| anyhow::anyhow!("poisoned"))?
        .len(),
      1
    );
  }
  let text = logs.text()?;
  assert!(text.contains("quantum sidecar request failed"), "{text}");
  assert!(text.contains("HTTP 503"), "{text}");
  assert!(!text.contains("hunter2"), "{text}");
  Ok(())
}

#[tokio::test]
async fn rejects_malformed_and_oversized_bodies() -> Result<()> {
  let logs = TestLogs::default();
  let _logging = tracing::subscriber::set_default(logs.subscriber());
  for body in [
    "not json".to_owned(),
    json!({"mode": "random", "qubits": 3, "base_index": 2, "overlay_index": 1}).to_string(),
    json!({"mode": "entangle", "qubits": 3, "base_index": 2, "overlay_index": 1, "x": 0})
      .to_string(),
    format!("{}{}", sample_body(), " ".repeat(MAX_BODY_BYTES)),
  ] {
    let (server, _seen) = sidecar(200, body).await?;
    let client = QuantumClient::new(&server.origin, None)?;
    assert_eq!(
      client.entangle(&request()).await,
      Err(QuantumError::Invalid)
    );
  }
  Ok(())
}

/// Accepts one connection on a raw socket and lets `reply` drive it.
async fn raw(reply: &'static [u8]) -> Result<Url> {
  let listener = TcpListener::bind("127.0.0.1:0").await?;
  let origin = Url::parse(&format!("http://{}", listener.local_addr()?))?;
  tokio::spawn(async move {
    if let Ok((mut socket, _)) = listener.accept().await {
      let mut request = [0; 1024];
      drop(socket.read(&mut request).await);
      drop(socket.write_all(reply).await);
      if reply.is_empty() {
        tokio::time::sleep(Duration::from_secs(5)).await;
      }
    }
  });
  Ok(origin)
}

#[tokio::test]
async fn reports_unreachable_slow_and_truncated_sidecars_as_unavailable() -> Result<()> {
  let logs = TestLogs::default();
  let _logging = tracing::subscriber::set_default(logs.subscriber());
  let closed = {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    Url::parse(&format!("http://{}", listener.local_addr()?))?
  };
  let client = QuantumClient::new(&closed, None)?;
  assert_eq!(
    client.entangle(&request()).await,
    Err(QuantumError::Unavailable)
  );

  let silent = raw(b"").await?;
  let client = QuantumClient::with_timeout(&silent, None, Duration::from_millis(100))?;
  assert_eq!(
    client.entangle(&request()).await,
    Err(QuantumError::Unavailable)
  );

  let truncated = raw(b"HTTP/1.1 200 OK\r\ncontent-length: 64\r\n\r\n{\"mode\"").await?;
  let client = QuantumClient::new(&truncated, None)?;
  assert_eq!(
    client.entangle(&request()).await,
    Err(QuantumError::Unavailable)
  );
  Ok(())
}

#[tokio::test]
async fn refuses_work_beyond_the_in_flight_limit() -> Result<()> {
  let (server, seen) = sidecar(200, sample_body()).await?;
  let client = QuantumClient::new(&server.origin, None)?;
  let held = client.in_flight.acquire_many(4).await?;
  assert_eq!(client.entangle(&request()).await, Err(QuantumError::Busy));
  drop(held);
  assert_eq!(client.entangle(&request()).await.map(indices), Ok(SAMPLE));
  assert_eq!(
    seen
      .lock()
      .map_err(|_error| anyhow::anyhow!("poisoned"))?
      .len(),
    1
  );
  Ok(())
}

#[tokio::test]
async fn accepts_only_http_urls_with_a_host() -> Result<()> {
  for url in [
    "ftp://quantum:3090",
    "unix:/tmp/quantum.sock",
    "data:text/plain,x",
    "http://quantum:3090/?token=x",
    "http://quantum:3090/#v1",
  ] {
    let error = QuantumClient::new(&Url::parse(url)?, None).err();
    assert_eq!(
      error.as_ref().map(ToString::to_string).as_deref(),
      Some(
        "the quantum sidecar URL must be an http or https URL with a host and no query or fragment"
      ),
      "{url}"
    );
    assert!(error.as_ref().and_then(Error::source).is_none());
  }
  for base in [
    "https://quantum.example/botge/",
    "https://quantum.example/botge",
  ] {
    assert_eq!(
      QuantumClient::new(&Url::parse(base)?, None)?
        .endpoint
        .as_str(),
      "https://quantum.example/botge/v1/entangle",
      "{base}"
    );
  }
  let failure = reqwest::Client::new()
    .get("http://[::1]:0/")
    .send()
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("port zero accepted a connection"))?;
  let error = ClientError::Http(failure);
  assert_eq!(
    error.to_string(),
    "the quantum sidecar HTTP client could not be built"
  );
  assert!(error.source().is_some());
  Ok(())
}
