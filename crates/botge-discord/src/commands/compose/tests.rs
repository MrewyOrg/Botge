//! Exercises compose command behavior.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use super::*;

#[tokio::test(start_paused = true)]
async fn bounds_the_entire_render_request_even_when_work_never_finishes() {
  let answer = render_reply(std::future::pending()).await;
  assert!(matches!(answer, Answer::Text(text) if text.contains("timed out")));
}

#[tokio::test]
async fn reports_inner_render_timeouts_without_hiding_other_failures() -> Result<()> {
  let timeout = tokio::time::timeout(Duration::ZERO, std::future::pending::<()>())
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("pending operation unexpectedly completed"))?;
  let answer = render_reply(async {
    Err(anyhow::Error::new(timeout).context("FFmpeg exceeded its rendering budget"))
  })
  .await;
  assert!(matches!(answer, Answer::Text(text) if text.contains("timed out")));
  let answer = render_reply(async { Err(anyhow::anyhow!("invalid fixture image")) }).await;
  assert!(matches!(answer, Answer::Text(text) if text.contains("Could not load or render")));
  Ok(())
}
