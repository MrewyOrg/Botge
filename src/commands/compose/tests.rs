//! Exercises compose command behavior.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
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

#[tokio::test]
async fn refreshes_legacy_variants_without_changing_saved_names_or_overlay_flags() -> Result<()> {
  use std::sync::Arc;

  use anyhow::Context as _;
  use axum::{Json, Router, routing::get};

  use crate::emotes::{
    Emotes,
    tests::{SEVEN_ID, seven_example},
  };

  let pixel = crate::tests::png_pixel()?;
  let server = crate::tests::TestServer::start(
    Router::new()
      .route(
        "/v3/emotes/{emote_id}",
        get(|| async { Json(seven_example("Fresh", true, 0)) }),
      )
      .route("/7tv/emote/{id}/2x.gif", get(move || async move { pixel })),
  )
  .await?;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  let mut legacy = crate::emotes::tests::example("Saved alias", SEVEN_ID);
  legacy.added = true;
  legacy.overlaying = true;
  assert!(store.add_emote(NonZeroU64::MIN, legacy.clone())?);
  let mut emotes = Emotes::new(
    crate::config::Providers {
      seven_added: true,
      ..Default::default()
    },
    Arc::clone(&store),
    None,
  )?;
  emotes.use_provider_fixture(server.origin.clone());
  let commands = Commands::new(Arc::new(emotes), Some(server.origin.clone()));
  let layer = commands
    .resolve_layer(&[legacy], "Saved alias", 2)
    .await?
    .context("legacy emote was not refreshed")?;
  assert!(layer.overlay);
  assert_eq!(
    layer.url.as_str(),
    format!("https://cdn.7tv.app/emote/{SEVEN_ID}/2x.gif")
  );
  assert!(matches!(
    commands
      .compose("Saved alias", Some(NonZeroU64::MIN), None, Some(2), false)
      .await?,
    Answer::Image(_)
  ));
  let saved = store.added_emotes(NonZeroU64::MIN)?;
  let saved = saved.first().context("saved emote disappeared")?;
  assert_eq!(saved.name, "Saved alias");
  assert!(saved.overlaying);
  assert!(saved.sizes.is_empty());
  assert!(
    matches!(commands.compose("", None, None, None, false).await?, Answer::Text(message) if message.contains("1 and 32"))
  );
  Ok(())
}
