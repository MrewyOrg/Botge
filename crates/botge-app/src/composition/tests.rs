//! Preserves persisted additions while resolving fresh rendering variants.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]
use super::*;

struct Fixture {
  _directory: tempfile::TempDir,
  store: std::sync::Arc<botge_storage::Store>,
  application: Application,
  server: botge_test_support::TestServer,
}

impl Fixture {
  async fn new() -> Result<Self> {
    use axum::{Json, Router, extract::Path, http::StatusCode, routing::get};
    let pixel = botge_test_support::png_pixel()?;
    let server = botge_test_support::TestServer::start(
      Router::new()
        .route(
          "/v3/emotes/{id}",
          get(|Path(id): Path<String>| async move {
            match id.as_str() {
              botge_test_support::SEVEN_ID => (
                StatusCode::OK,
                Json(botge_test_support::seven_example("Fresh", false, 0)),
              ),
              "bbbbbbbbbbbbbbbbbbbbbbbb" => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({}))),
              _ => (StatusCode::NOT_FOUND, Json(serde_json::json!({}))),
            }
          }),
        )
        .route(
          "/7tv/emote/{id}/2x.png",
          get(move || {
            let pixel = pixel.clone();
            async move { pixel }
          }),
        ),
    )
    .await?;
    let directory = tempfile::tempdir()?;
    let store = std::sync::Arc::new(botge_storage::Store::open(
      &directory.path().join("composition.redb"),
    )?);
    let mut application = Application::new(
      botge_domain::providers::Providers {
        seven_added: true,
        ..Default::default()
      },
      std::sync::Arc::clone(&store),
    )?;
    application.use_provider_fixture(server.origin.clone());
    Ok(Self {
      _directory: directory,
      store,
      application,
      server,
    })
  }
  fn request<'a>(&'a self, input: &'a str) -> ComposeRequest<'a> {
    ComposeRequest {
      input,
      guild: Some(NonZeroU64::MIN),
      user: None,
      scale: None,
      stretch: false,
      cache: Some(&self.server.origin),
    }
  }
}

#[tokio::test]
async fn refreshes_legacy_variants_without_changing_saved_names_or_overlay_flags() -> Result<()> {
  use std::sync::Arc;

  use anyhow::Context as _;
  use axum::{Json, Router, routing::get};

  use crate::Application;
  use botge_test_support::{SEVEN_ID, example, seven_example};

  let pixel = botge_test_support::png_pixel()?;
  let server = botge_test_support::TestServer::start(
    Router::new()
      .route(
        "/v3/emotes/{emote_id}",
        get(|| async { Json(seven_example("Fresh", true, 0)) }),
      )
      .route("/7tv/emote/{id}/2x.gif", get(move || async move { pixel })),
  )
  .await?;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(botge_storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  let mut legacy = example("Saved alias", SEVEN_ID);
  legacy.added = true;
  legacy.overlaying = true;
  assert_eq!(
    store.add_emote(
      botge_storage::CatalogEditor::system(NonZeroU64::MIN),
      legacy.clone()
    )?,
    botge_storage::AddEmoteOutcome::Added
  );
  let mut emotes = Application::new(
    botge_domain::providers::Providers {
      seven_added: true,
      ..Default::default()
    },
    Arc::clone(&store),
  )?;
  emotes.use_provider_fixture(server.origin.clone());
  let application = emotes;
  let layer = application
    .resolve_layer(&Catalog::new(vec![legacy], vec![]), "Saved alias", 2)
    .await?
    .context("legacy emote was not refreshed")?;
  assert!(layer.overlay);
  assert_eq!(
    layer.url().as_str(),
    format!("https://cdn.7tv.app/emote/{SEVEN_ID}/2x.gif")
  );
  assert!(matches!(
    application
      .compose(ComposeRequest {
        input: "Saved alias",
        guild: Some(NonZeroU64::MIN),
        user: None,
        scale: Some(2),
        stretch: false,
        cache: Some(&server.origin)
      })
      .await?,
    Composition::Image(_)
  ));
  let saved = store.added_emotes(NonZeroU64::MIN)?;
  let saved = saved.first().context("saved emote disappeared")?;
  assert_eq!(saved.name, "Saved alias");
  assert!(saved.overlaying);
  assert!(saved.sizes.is_empty());
  assert!(
    matches!(application.compose(ComposeRequest {input:"",guild:None,user:None,scale:None,stretch:false,cache:None}).await?, Composition::Text(message) if message.contains("1 and 32"))
  );
  Ok(())
}

#[tokio::test]
async fn rejects_input_before_network_and_releases_admission_after_failures() -> Result<()> {
  use std::assert_matches;
  let fixture = Fixture::new().await?;
  for input in [String::new(), "\u{00a0}\t\n".into(), "Wave ".repeat(33)] {
    assert_matches!(fixture.application.compose(fixture.request(&input)).await?,Composition::Text(message) if message.contains("1 and 32"));
  }
  assert_matches!(fixture.application.compose(fixture.request("`missing`")).await?,Composition::Text(message) if !message.contains("``"));
  assert_matches!(
    fixture
      .application
      .compose(fixture.request("7tv:aaaaaaaaaaaaaaaaaaaaaaaa"))
      .await?,
    Composition::Text(_)
  );
  assert_matches!(
    fixture
      .application
      .compose(fixture.request("7tv:bbbbbbbbbbbbbbbbbbbbbbbb"))
      .await,
    Err(_)
  );
  assert_matches!(fixture.application.render_slot.try_acquire(), Ok(_));
  fixture.store.invalidate_table("guild_emotes")?;
  assert_matches!(
    fixture.application.compose(fixture.request("Wave")).await,
    Err(_)
  );
  assert_matches!(fixture.application.render_slot.try_acquire(), Ok(_));
  Ok(())
}

#[tokio::test]
async fn resolves_published_and_provider_records_without_refreshing_legacy_metadata() -> Result<()>
{
  use anyhow::Context as _;
  let fixture = Fixture::new().await?;
  let mut published = botge_test_support::example("Published", "published");
  published.sizes.insert(2, published.image.clone());
  let mut provider = botge_test_support::example("Provider", "provider");
  provider.added = false;
  let invalid_id = botge_test_support::example("Legacy ID", "not-a-7tv-id");
  let mut blocked = botge_test_support::example("Blocked", "blocked");
  blocked.added = false;
  blocked.image = "https://untrusted.example/image.png".into();
  let entries = Catalog::new(vec![published, provider, invalid_id, blocked], vec![]);
  for name in ["Published", "Provider", "Legacy ID"] {
    assert!(
      fixture
        .application
        .resolve_layer(&entries, name, 2)
        .await?
        .is_some(),
      "{name}"
    );
  }
  assert!(
    fixture
      .application
      .resolve_layer(&entries, "Blocked", 2)
      .await?
      .is_none()
  );
  assert!(
    fixture
      .application
      .resolve_layer(&entries, "Missing", 2)
      .await?
      .is_none()
  );

  let stored = botge_test_support::example("Stored", botge_test_support::SEVEN_ID);
  assert_eq!(
    fixture.store.add_emote(
      botge_storage::CatalogEditor::system(NonZeroU64::MIN),
      stored
    )?,
    botge_storage::AddEmoteOutcome::Added
  );
  fixture
    .store
    .save_emote_border(NonZeroU64::MIN, Some(0x0012_3456))?;
  let mut request = fixture.request("Stored");
  request.user = Some(NonZeroU64::MIN);
  let image = fixture.application.compose(request).await?;
  let Composition::Image(image) = image else {
    anyhow::bail!("border composition did not render")
  };
  assert_eq!(image.filename, "emotes.png");
  assert_ne!(image.bytes, Vec::<u8>::new());
  let rows = fixture.store.added_emotes(NonZeroU64::MIN)?;
  assert_eq!(
    rows.first().context("stored record disappeared")?.name,
    "Stored"
  );
  Ok(())
}

#[tokio::test]
async fn propagates_legacy_lookup_download_and_preference_failures_without_leaking_admission()
-> Result<()> {
  let fixture = Fixture::new().await?;
  let legacy = botge_test_support::example("Unavailable", "bbbbbbbbbbbbbbbbbbbbbbbb");
  std::assert_matches!(
    fixture
      .application
      .resolve_layer(&Catalog::new(vec![legacy], vec![]), "Unavailable", 2)
      .await,
    Err(_)
  );
  let mut request = fixture.request("7tv:01234567890123456789012345");
  // A loopback cache without the media route rejects downloads without contacting the CDN.
  let empty = botge_test_support::TestServer::start(axum::Router::new()).await?;
  request.cache = Some(&empty.origin);
  std::assert_matches!(fixture.application.compose(request).await, Err(_));
  request.input = "7tv:01234567890123456789012345 7tv:01234567890123456789012345";
  std::assert_matches!(fixture.application.compose(request).await, Err(_));
  fixture.store.invalidate_table("emote_borders")?;
  request.input = "7tv:01234567890123456789012345";
  request.user = Some(NonZeroU64::MIN);
  std::assert_matches!(fixture.application.compose(request).await, Err(_));
  std::assert_matches!(fixture.application.render_slot.try_acquire(), Ok(_));
  Ok(())
}

#[tokio::test]
async fn shares_admission_between_requests_and_resolves_distinct_stored_names() -> Result<()> {
  let fixture = Fixture::new().await?;
  let mut wave = botge_test_support::example("Wave", "wave");
  wave.sizes.insert(2, wave.image.clone());
  let mut hat = botge_test_support::example("Hat", "hat");
  hat.sizes.insert(2, hat.image.clone());
  assert_eq!(
    fixture
      .store
      .add_emote(botge_storage::CatalogEditor::system(NonZeroU64::MIN), wave)?,
    botge_storage::AddEmoteOutcome::Added
  );
  assert_eq!(
    fixture
      .store
      .add_emote(botge_storage::CatalogEditor::system(NonZeroU64::MIN), hat)?,
    botge_storage::AddEmoteOutcome::Added
  );
  // Renders below the limit run together; only a full set of slots turns a request away.
  let others = fixture
    .application
    .render_slot
    .acquire_many(u32::try_from(crate::RENDER_SLOTS - 1)?)
    .await?;
  std::assert_matches!(
    fixture
      .application
      .compose(fixture.request("Wave Hat"))
      .await?,
    Composition::Image(_)
  );
  let last = fixture.application.render_slot.acquire().await?;
  std::assert_matches!(fixture.application.compose(fixture.request("Wave Hat")).await?, Composition::Text(message) if message.contains("too many emotes"));
  drop((others, last));
  std::assert_matches!(
    fixture
      .application
      .compose(fixture.request("Wave Hat"))
      .await?,
    Composition::Image(_)
  );
  Ok(())
}
