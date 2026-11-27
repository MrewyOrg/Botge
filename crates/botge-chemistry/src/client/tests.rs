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
use tokio::{io::AsyncWriteExt as _, net::TcpListener, sync::Notify};

use super::*;
use crate::{Condition, substrate_index};

fn sample_request() -> ReactRequest {
  ReactRequest {
    reactant_a: substrate_index("a"),
    reactant_b: substrate_index("b"),
    condition: Condition::Auto,
    base_pool_size: 4,
    overlay_pool_size: 2,
    exclude_base_indices: vec![],
    include_diagram: false,
  }
}

async fn sidecar(
  status: u16,
  body: String,
) -> Result<(TestServer, Arc<Mutex<Vec<(Value, Option<String>)>>>)> {
  let seen = Arc::new(Mutex::new(Vec::new()));
  let log = Arc::clone(&seen);
  let router = Router::new().route(
    "/v1/react",
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

#[tokio::test]
async fn posts_react_with_bearer_and_maps_status_codes() -> Result<()> {
  let logs = TestLogs::default();
  let _logging = tracing::subscriber::set_default(logs.subscriber());
  let ok_body = json!({
    "outcome": "no_reaction",
    "substrate_a_name": "a",
    "substrate_a_group": "g1",
    "substrate_b_name": "b",
    "substrate_b_group": "g2",
    "reason": "none",
    "hint_condition": null,
    "hint_reaction": null
  })
  .to_string();
  let (server, seen) = sidecar(200, ok_body).await?;
  let mut subpath = server.origin.clone();
  subpath.set_path("");
  let client = ChemistryClient::new(&subpath, Secret::new("chem-tok"))?;
  let response = client.react(&sample_request()).await?;
  assert!(matches!(response, ReactResponse::NoReaction { .. }));
  let calls = seen
    .lock()
    .map_or_else(|poison| poison.into_inner().clone(), |guard| guard.clone());
  assert_eq!(
    calls.first().and_then(|(_, auth)| auth.as_deref()),
    Some("Bearer chem-tok")
  );

  let (refused_srv, _) = sidecar(422, "{}".into()).await?;
  let refused = ChemistryClient::new(&refused_srv.origin, None)?;
  assert_eq!(
    refused.react(&sample_request()).await,
    Err(ChemError::Refused)
  );

  let (unavail_srv, _) = sidecar(503, "{}".into()).await?;
  let unavail = ChemistryClient::new(&unavail_srv.origin, None)?;
  assert_eq!(
    unavail.react(&sample_request()).await,
    Err(ChemError::Unavailable)
  );

  let (bad_json_srv, _) = sidecar(200, "{not-json".into()).await?;
  let invalid = ChemistryClient::new(&bad_json_srv.origin, None)?;
  assert_eq!(
    invalid.react(&sample_request()).await,
    Err(ChemError::Invalid)
  );

  let (oversized_srv, _) = sidecar(200, "x".repeat(MAX_BODY_BYTES + 1)).await?;
  let oversized = ChemistryClient::new(&oversized_srv.origin, None)?;
  assert_eq!(
    oversized.react(&sample_request()).await,
    Err(ChemError::Invalid)
  );
  Ok(())
}

#[tokio::test]
async fn rejects_busy_saturated_timeouts_and_truncated_bodies() -> Result<()> {
  let release = Arc::new(Notify::new());
  let gate = Arc::clone(&release);
  let slow_router = Router::new().route(
    "/v1/react",
    post(move || {
      let gate = Arc::clone(&gate);
      async move {
        gate.notified().await;
        AxumStatus::SERVICE_UNAVAILABLE
      }
    }),
  );
  let slow_server = TestServer::start(slow_router).await?;
  let client = Arc::new(ChemistryClient::with_timeout(
    &slow_server.origin,
    None,
    Duration::from_secs(2),
  )?);
  let mut pending = Vec::new();
  for _ in 0..MAX_IN_FLIGHT {
    let client = Arc::clone(&client);
    pending.push(tokio::spawn(async move {
      client.react(&sample_request()).await
    }));
  }
  while client.in_flight.available_permits() > 0 {
    tokio::task::yield_now().await;
  }
  assert_eq!(client.react(&sample_request()).await, Err(ChemError::Busy));
  release.notify_waiters();
  for task in pending {
    assert_eq!(task.await?, Err(ChemError::Unavailable));
  }

  let timeout_client =
    ChemistryClient::with_timeout(&slow_server.origin, None, Duration::from_millis(20))?;
  assert_eq!(
    timeout_client.react(&sample_request()).await,
    Err(ChemError::Unavailable)
  );

  // Truncated HTTP body triggers read_body chunk error -> ChemError::Unavailable.
  let listener = TcpListener::bind("127.0.0.1:0").await?;
  let addr = listener.local_addr()?;
  tokio::spawn(async move {
    if let Ok((mut stream, _)) = listener.accept().await {
      drop(
        stream
          .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial")
          .await,
      );
      drop(stream.shutdown().await);
    }
  });
  let trunc_url = Url::parse(&format!("http://{addr}/"))?;
  let trunc_client = ChemistryClient::new(&trunc_url, None)?;
  assert_eq!(
    trunc_client.react(&sample_request()).await,
    Err(ChemError::Unavailable)
  );

  // Closed port fails transport send -> ChemError::Unavailable.
  drop(slow_server);
  assert_eq!(
    client.react(&sample_request()).await,
    Err(ChemError::Unavailable)
  );
  Ok(())
}

#[tokio::test]
async fn rejects_invalid_urls_and_formats_client_errors() -> Result<()> {
  for raw in [
    "http://localhost:3091/?q=1",
    "http://localhost:3091/#frag",
    "ftp://localhost:3091",
  ] {
    let url = Url::parse(raw)?;
    let Err(error) = ChemistryClient::new(&url, None) else {
      anyhow::bail!("expected Url error for {raw}");
    };
    assert!(matches!(error, ClientError::Url));
    assert!(error.to_string().contains("http or https"));
    assert!(error.source().is_none());
  }
  for base in [
    "https://chemistry.example/botge/",
    "https://chemistry.example/botge",
  ] {
    assert_eq!(
      ChemistryClient::new(&Url::parse(base)?, None)?
        .endpoint
        .as_str(),
      "https://chemistry.example/botge/v1/react"
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
    "the chemistry sidecar HTTP client could not be built"
  );
  assert!(error.source().is_some());
  Ok(())
}
