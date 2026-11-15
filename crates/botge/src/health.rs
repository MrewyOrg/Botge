//! Internal process liveness and Discord readiness, independent of Activity credentials.

use std::{sync::Arc, time::Duration};

use axum::{
  Router,
  http::{StatusCode, header},
  routing::get,
};
use tokio::sync::watch;

use botge_app::Application;

/// Reports executor liveness separately from gateway readiness. Expose only on a private network.
///
/// `/metrics` adds gateway readiness and the build version to the application's counters in the
/// Prometheus text format. Counters reset when the process restarts.
pub(crate) fn router(ready: watch::Receiver<bool>, application: Arc<Application>) -> Router {
  let metrics_ready = ready.clone();
  Router::new()
    .route(
      "/metrics",
      get(move || {
        let ready = u8::from(*metrics_ready.borrow());
        let application = Arc::clone(&application);
        async move { metrics(&application, ready) }
      }),
    )
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

/// Renders application counters followed by readiness and build information.
fn metrics(
  application: &Application,
  ready: u8,
) -> ([(header::HeaderName, &'static str); 1], String) {
  let body = format!(
    "{}# HELP botge_gateway_ready Whether the Discord gateway is ready.\n\
     # TYPE botge_gateway_ready gauge\n\
     botge_gateway_ready {ready}\n\
     # HELP botge_build_info Running Botge version.\n\
     # TYPE botge_build_info gauge\n\
     botge_build_info{{version=\"{}\"}} 1\n",
    application.render_metrics(),
    env!("CARGO_PKG_VERSION")
  );
  (
    [(
      header::CONTENT_TYPE,
      "text/plain; version=0.0.4; charset=utf-8",
    )],
    body,
  )
}

/// Checks readiness without loading credentials or opening the database.
///
/// # Errors
///
/// Returns an error if the HTTP client cannot be initialized, the request fails or exceeds
/// the two-second deadline, or the endpoint returns an HTTP error status.
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
