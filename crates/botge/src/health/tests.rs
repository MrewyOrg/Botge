//! Checks liveness, readiness, and metrics through a loopback HTTP server.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use super::*;
use botge_storage::Store;
use botge_test_support::TestServer;

/// Builds an application over a temporary database; keep the directory alive for the test.
fn application() -> anyhow::Result<(tempfile::TempDir, Arc<Application>)> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("botge.redb"))?);
  let application = Application::new(botge_domain::providers::Providers::default(), store, None)?;
  Ok((directory, Arc::new(application)))
}

#[tokio::test]
async fn separates_gateway_readiness_from_liveness_and_recovers() -> anyhow::Result<()> {
  let (_directory, application) = application()?;
  let (sender, receiver) = watch::channel(false);
  let server = TestServer::start(router(receiver, application)).await?;
  let live = server.origin.join("healthz")?;
  let ready = server.origin.join("readyz")?;
  check(live.as_str()).await?;
  assert!(check(ready.as_str()).await.is_err());
  sender.send_replace(true);
  check(ready.as_str()).await?;
  sender.send_replace(false);
  assert!(check(ready.as_str()).await.is_err());
  check(live.as_str()).await?;
  assert!(check("http://127.0.0.1:0/readyz").await.is_err());
  Ok(())
}

#[tokio::test]
async fn exposes_counters_readiness_and_version_as_prometheus_text() -> anyhow::Result<()> {
  let (_directory, application) = application()?;
  application.metrics().command("emote-compose");
  let (sender, receiver) = watch::channel(false);
  let server = TestServer::start(router(receiver, application)).await?;
  let url = server.origin.join("metrics")?;
  let scrape = || async {
    let response = reqwest::get(url.as_str()).await?.error_for_status()?;
    let kind = response.headers().get(header::CONTENT_TYPE).cloned();
    Ok::<_, anyhow::Error>((kind, response.text().await?))
  };
  let (kind, text) = scrape().await?;
  assert_eq!(
    kind.as_ref().map(axum::http::HeaderValue::as_bytes),
    Some(&b"text/plain; version=0.0.4; charset=utf-8"[..])
  );
  assert!(text.contains("botge_commands_total{command=\"emote-compose\"} 1\n"));
  assert!(text.contains("botge_gateway_ready 0\n"));
  let version = format!(
    "botge_build_info{{version=\"{}\"}} 1\n",
    env!("CARGO_PKG_VERSION")
  );
  assert!(text.contains(&version));
  sender.send_replace(true);
  assert!(scrape().await?.1.contains("botge_gateway_ready 1\n"));
  Ok(())
}
