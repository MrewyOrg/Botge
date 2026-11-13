//! Internal process liveness and Discord readiness, independent of Activity credentials.

use std::time::Duration;

use axum::{Router, http::StatusCode, routing::get};
use tokio::sync::watch;

/// Reports executor liveness separately from gateway readiness. Expose only on a private network.
pub(crate) fn router(ready: watch::Receiver<bool>) -> Router {
  Router::new()
    .route("/healthz", get(|| async { StatusCode::NO_CONTENT }))
    .route(
      "/readyz",
      get(move || {
        let ready = *ready.borrow();
        async move {
          if ready {
            StatusCode::NO_CONTENT
          } else {
            StatusCode::SERVICE_UNAVAILABLE
          }
        }
      }),
    )
}

/// Checks readiness without loading credentials or opening the database.
pub(crate) async fn check(url: &str) -> anyhow::Result<()> {
  reqwest::Client::builder()
    .timeout(Duration::from_secs(2))
    .build()?
    .get(url)
    .send()
    .await?
    .error_for_status()?;
  Ok(())
}

#[cfg(test)]
mod tests;
