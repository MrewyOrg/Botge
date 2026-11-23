//! Uses local provider responses to exercise normalization, cache expiry, and shared refreshes.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::assert_matches;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::{Json, Router, routing::get};
use botge_test_support::{SEVEN_ID, seven_example};
use serde_json::json;

use anyhow::Context as _;

use super::*;
use crate::tests::TestServer;

#[tokio::test]
async fn bounds_refresh_admission_and_evicts_the_oldest_snapshot() -> Result<()> {
  let server =
    TestServer::start(Router::new().route("/new", get(|| async { Json(json!([])) }))).await?;
  let mut client = ProviderClient::new()?;
  client.test_origin = Some(server.origin.clone());
  let client = Arc::new(client);
  for index in 0..MAX_REFRESHES {
    let (_sender, receiver) = watch::channel(None);
    client
      .refreshing
      .lock()
      .await
      .insert(format!("pending-{index}"), receiver);
  }
  assert_eq!(client.cached("pending-0".into()).await.as_ref(), []);
  assert_eq!(client.cached("uncached".into()).await.as_ref(), []);
  let stale = Arc::from([botge_test_support::example("Stale", "stale")]);
  client.cache.lock().await.insert(
    "stale".into(),
    Cached {
      emotes: Arc::clone(&stale),
      expires: Instant::now(),
      set_id: None,
    },
  );
  assert_eq!(client.cached("stale".into()).await.as_ref(), stale.as_ref());
  client.refreshing.lock().await.clear();
  {
    let mut cache = client.cache.lock().await;
    cache.clear();
    let now = Instant::now();
    for index in 0..64 {
      cache.insert(
        format!("old-{index}"),
        Cached {
          emotes: Arc::from([]),
          expires: now + Duration::from_secs(index),
          set_id: None,
        },
      );
    }
    drop(cache)
  };
  assert_eq!(
    client
      .refresh("https://provider.example/new")
      .await
      .as_ref(),
    []
  );
  let cache = client.cache.lock().await;
  assert_eq!(cache.len(), 64);
  assert!(!cache.contains_key("old-0"));
  assert!(cache.contains_key("https://provider.example/new"));
  drop(cache);
  // Updating an existing full-cache entry must not evict another feed.
  assert_eq!(
    client
      .refresh("https://provider.example/new")
      .await
      .as_ref(),
    []
  );
  assert_eq!(client.cache.lock().await.len(), MAX_FEEDS);
  Ok(())
}

#[tokio::test]
async fn rejects_oversized_chunked_responses_and_invalid_provider_metadata() -> Result<()> {
  let server = TestServer::start(
    Router::new()
      .route(
        "/chunked",
        get(|| async {
          axum::response::Response::new(axum::body::Body::from_stream(futures_util::stream::iter(
            [Ok::<_, std::io::Error>(vec![0_u8; 8])],
          )))
        }),
      )
      .route(
        "/invalid",
        get(|| async { Json(json!({"id":"invalid","emotes":[]})) }),
      )
      .route("/broken", get(|| async { "invalid JSON" })),
  )
  .await?;
  let mut client = ProviderClient::new()?;
  client.test_origin = Some(server.origin.clone());
  let response = client
    .http
    .get(server.origin.join("chunked")?)
    .send()
    .await?;
  assert_eq!(response.content_length(), None);
  assert_matches!(bounded_bytes(response, 4).await, Err(_));
  let (_, id) = client.fetch("https://provider.example/invalid").await?;
  assert_eq!(id, None);
  assert_matches!(
    client.fetch("https://provider.example/broken").await,
    Err(_)
  );
  Ok(())
}

#[tokio::test]
async fn fetches_all_enabled_feeds_and_reuses_cached_results() -> Result<()> {
  let http = TestServer::start(
    Router::new()
      .route(
        "/v3/emote-sets/{id}",
        get(|| async {
          Json(json!({"emotes":[{"name":"Set","flags":0,"data":seven_example("Set", false, 0)}]}))
        }),
      )
      .route(
        "/v3/emotes/{id}",
        get(
          |axum::extract::Path(id): axum::extract::Path<String>| async move {
            if id == SEVEN_ID {
              Ok(Json(seven_example("Added", false, 256)))
            } else {
              Err(StatusCode::NOT_FOUND)
            }
          },
        ),
      )
      .route("/large", get(|| async { "longer than four bytes" })),
  )
  .await?;
  let mut client = ProviderClient::new()?;
  client.test_origin = Some(http.origin.clone());
  let client = Arc::new(client);
  let policy = Providers {
    seven_global: true,
    seven_personal: true,
    seven_added: true,
  };
  let guild = GuildEmotes {
    seven_tv_set: Some(SEVEN_ID.into()),
    ..GuildEmotes::default()
  };
  assert_eq!(client.catalog(policy, &guild, true, None).await.len(), 2);
  // Without the global feeds, only the set selected by the guild remains.
  assert_eq!(client.catalog(policy, &guild, false, None).await.len(), 1);
  assert_eq!(
    client
      .catalog(policy, &GuildEmotes::default(), true, None)
      .await
      .len(),
    1
  );
  let added = client
    .added(SEVEN_ID)
    .await?
    .context("missing added emote")?;
  assert!(added.added && added.overlaying);
  assert!(client.added("not-found").await?.is_none());
  assert_matches!(
    bounded_bytes(client.http.get(http.origin.join("large")?).send().await?, 4).await,
    Err(_)
  );
  drop(http);
  assert_eq!(client.catalog(policy, &guild, true, None).await.len(), 2);
  let unavailable = client.cached("https://7tv.io/invalid".into()).await;
  assert!(unavailable.is_empty());
  Ok(())
}

#[tokio::test]
async fn keeps_stale_emotes_during_a_provider_outage_and_recovers_after_retry() -> Result<()> {
  let requests = Arc::new(AtomicUsize::new(0));
  let server = TestServer::start(Router::new().route(
    "/emotes",
    get({
      let requests = Arc::clone(&requests);
      move || async move {
        let code = match requests.fetch_add(1, Ordering::Relaxed) {
          0 => "Wave",
          1 => return Err(StatusCode::SERVICE_UNAVAILABLE),
          _ => "Updated",
        };
        Ok(Json(
          json!({"emotes":[{"name":code,"flags":0,"data":seven_example(code, false, 0)}]}),
        ))
      }
    }),
  ))
  .await?;
  let client = Arc::new(ProviderClient::new()?);
  let url = server.origin.join("emotes")?.to_string();

  for (attempt, expected) in ["Wave", "Wave", "Updated"].into_iter().enumerate() {
    if attempt > 0 {
      // Force expiry to exercise retry behavior without waiting out the cache lifetime.
      client
        .cache
        .lock()
        .await
        .get_mut(&url)
        .context("missing provider cache entry")?
        .expires = Instant::now();
    }
    let entries = client.cached(url.clone()).await;
    assert_eq!(
      entries.first().map(|emote| emote.name.as_str()),
      Some(expected)
    );
    assert_eq!(&*client.cached(url.clone()).await, &*entries);
    assert_eq!(requests.load(Ordering::Relaxed), attempt + 1);
  }
  Ok(())
}

#[tokio::test]
async fn slow_autocomplete_feeds_finish_one_shared_refresh_after_the_deadline() -> Result<()> {
  let requests = Arc::new(AtomicUsize::new(0));
  let release = Arc::new(tokio::sync::Notify::new());
  let server = TestServer::start(Router::new().route(
    "/v3/emote-sets/global",
    get({
      let requests = Arc::clone(&requests);
      let release = Arc::clone(&release);
      move || async move {
        requests.fetch_add(1, Ordering::Relaxed);
        release.notified().await;
        Json(json!({"emotes":[{"name":"SlowWave","flags":0,"data":seven_example("SlowWave", false, 0)}]}))
      }
    }),
  ))
  .await?;
  let mut client = ProviderClient::new()?;
  client.test_origin = Some(server.origin.clone());
  let client = Arc::new(client);
  let policy = Providers {
    seven_global: true,
    ..Providers::default()
  };
  let guild = GuildEmotes::default();
  let deadline = Some(Duration::from_millis(30));
  // Keep the server blocked until both callers have hit their deadlines.
  let (first, second) = tokio::join!(
    client.catalog(policy, &guild, true, deadline),
    client.catalog(policy, &guild, true, deadline)
  );
  assert!(first.is_empty() && second.is_empty());
  release.notify_one();
  let cached = tokio::time::timeout(
    Duration::from_secs(2),
    client.catalog(policy, &guild, true, None),
  )
  .await?;
  assert_eq!(
    cached
      .iter()
      .flat_map(|feed| feed.iter())
      .next()
      .map(|entry| entry.name.as_str()),
    Some("SlowWave")
  );
  assert_eq!(client.catalog(policy, &guild, true, deadline).await, cached);
  assert_eq!(requests.load(Ordering::Relaxed), 1);
  Ok(())
}

#[test]
fn maps_only_usable_fixture_origins_and_provider_urls() -> Result<()> {
  let mut client = ProviderClient::new()?;
  assert_eq!(client.endpoint("not a URL"), "not a URL");
  client.test_origin = Some(Url::parse("http://127.0.0.1:1234")?);
  assert_eq!(client.endpoint("not a URL"), "not a URL");
  assert_eq!(
    client.endpoint("https://provider.example/feed"),
    "http://127.0.0.1:1234/feed"
  );
  client.test_origin = Some(Url::parse("mailto:fixture@example.com")?);
  assert_eq!(
    client.endpoint("https://provider.example/feed"),
    "https://provider.example/feed"
  );
  Ok(())
}

#[tokio::test]
async fn rejects_transport_failures_midway_through_a_chunked_body() -> Result<()> {
  use axum::body::{Body, Bytes};
  let server = TestServer::start(Router::new().route(
    "/interrupted",
    get(|| async {
      Body::from_stream(futures_util::stream::unfold(0, |stage| async move {
        if stage == 0 {
          Some((Ok(Bytes::from_static(b"partial")), 1))
        } else if stage == 1 {
          tokio::time::sleep(Duration::from_millis(20)).await;
          Some((Err(std::io::Error::other("fixture body interrupted")), 2))
        } else {
          None
        }
      }))
    }),
  ))
  .await?;
  let response = Client::new()
    .get(server.origin.join("/interrupted")?)
    .send()
    .await?;
  assert_matches!(bounded_bytes(response, MAX_PAYLOAD).await, Err(_));
  Ok(())
}

#[tokio::test]
async fn forwards_provider_outages_to_legacy_logging() -> Result<()> {
  let Some(logs) = botge_test_support::legacy_logging_fixture(
    "emotes::providers::tests::forwards_provider_outages_to_legacy_logging",
  )?
  else {
    return Ok(());
  };
  let server = TestServer::start(Router::new()).await?;
  let mut client = ProviderClient::new()?;
  client.test_origin = Some(server.origin.clone());
  assert_eq!(
    client
      .refresh("https://provider.example/missing")
      .await
      .as_ref(),
    []
  );
  assert_matches!(
    tokio::time::timeout(
      Duration::from_millis(20),
      client.watch_sets("invalid socket URL")
    )
    .await,
    Err(_)
  );
  let text = logs.text()?;
  assert!(text.contains("could not refresh emote provider"));
  assert!(text.contains("7TV event stream disconnected"));
  Ok(())
}
