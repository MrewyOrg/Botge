//! Uses local provider responses to exercise normalization, cache expiry, and shared refreshes.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use std::sync::atomic::{AtomicUsize, Ordering};

use axum::{
  Json, Router,
  http::StatusCode,
  routing::{get, post},
};
use serde_json::{Value, json};

use super::*;
use crate::tests::TestServer;

#[tokio::test]
async fn bounds_refresh_admission_and_evicts_the_oldest_snapshot() -> Result<()> {
  let server =
    TestServer::start(Router::new().route("/new", get(|| async { Json(json!([])) }))).await?;
  let mut client = ProviderClient::new(None)?;
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
  assert_eq!(
    client
      .cached(Feed::BetterTtv, "pending-0".into())
      .await
      .as_ref(),
    []
  );
  assert_eq!(
    client
      .cached(Feed::BetterTtv, "uncached".into())
      .await
      .as_ref(),
    []
  );
  let stale = Arc::from([crate::emotes::tests::example("Stale", "stale")]);
  client.cache.lock().await.insert(
    "stale".into(),
    Cached {
      emotes: Arc::clone(&stale),
      expires: Instant::now(),
      set_id: None,
    },
  );
  assert_eq!(
    client
      .cached(Feed::BetterTtv, "stale".into())
      .await
      .as_ref(),
    stale.as_ref()
  );
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
    drop(cache);
  }
  assert_eq!(
    client
      .refresh(Feed::BetterTtv, "https://provider.example/new")
      .await
      .as_ref(),
    []
  );
  let cache = client.cache.lock().await;
  assert_eq!(cache.len(), 64);
  assert!(!cache.contains_key("old-0"));
  assert!(cache.contains_key("https://provider.example/new"));
  drop(cache);
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
  let mut client = ProviderClient::new(None)?;
  client.test_origin = Some(server.origin.clone());
  let response = client
    .http
    .get(server.origin.join("chunked")?)
    .send()
    .await?;
  assert_eq!(response.content_length(), None);
  assert!(bounded_bytes(response, 4).await.is_err());
  let (_, id) = client
    .fetch(Feed::SevenTv, "https://provider.example/invalid")
    .await?;
  assert_eq!(id, None);
  assert!(
    client
      .fetch(Feed::SevenTv, "https://provider.example/broken")
      .await
      .is_err()
  );
  assert!(
    client
      .fetch(Feed::Twitch, "https://provider.example/invalid")
      .await
      .is_err()
  );
  Ok(())
}

pub(crate) const SEVEN_ID: &str = "01234567890123456789012345";

/// Builds a 7TV response with a fixed ID and both static and animated image variants.
pub(crate) fn seven_example(name: &str, animated: bool, flags: u32) -> Value {
  json!({
      "id": SEVEN_ID, "name": name, "animated": animated, "flags": flags,
      "host": { "files": [{ "name": "2x.png" }, { "name": "2x.gif" }] }
  })
}

#[tokio::test]
async fn fetches_all_enabled_feeds_and_reuses_cached_results() -> Result<()> {
  let http = TestServer::start(Router::new()
        .route("/v3/emote-sets/{id}", get(|| async { Json(json!({"emotes":[{"name":"Set","flags":0,"data":seven_example("Set", false, 0)}]})) }))
        .route("/v3/emotes/{id}", get(|axum::extract::Path(id): axum::extract::Path<String>| async move {
            if id == SEVEN_ID { Ok(Json(seven_example("Added", false, 256))) } else { Err(StatusCode::NOT_FOUND) }
        }))
        .route("/3/cached/emotes/global", get(|| async { Json(json!([{"id":"valid","code":"Global","animated":false}])) }))
        .route("/3/cached/users/twitch/{id}", get(|| async { Json(json!({"channelEmotes":[{"id":"valid","code":"Personal","animated":false}],"sharedEmotes":[]})) }))
        .route("/v1/room/{name}", get(|| async { Json(json!({"room":{"set":7},"sets":{"7":{"emoticons":[{"id":12,"name":"Room","urls":{"2":"//cdn.frankerfacez.com/emote/12/2"}}]}}})) }))
        .route("/v1/set/global", get(|| async { Json(json!({"sets":{"3":{"emoticons":[{"id":13,"name":"Global","urls":{"2":"//cdn.frankerfacez.com/emote/13/2"}}]}}})) }))
        .route("/oauth2/token", post(|| async { Json(json!({"access_token":"fixture"})) }))
        .route("/helix/chat/emotes/global", get(|| async { Json(json!({"data":[{"id":"valid","name":"Global","format":["static"]}]})) }))
        .route("/large", get(|| async { "longer than four bytes" }))).await?;
  let mut client = ProviderClient::new(Some(("fixture".into(), "fixture".into())))?;
  client.test_origin = Some(http.origin.clone());
  let client = Arc::new(client);
  let policy = Providers {
    seven_global: true,
    seven_personal: true,
    seven_added: true,
    bttv: true,
    ffz: true,
    twitch: true,
  };
  let guild = GuildEmotes {
    seven_tv_set: Some(SEVEN_ID.into()),
    bttv_twitch_id: Some("42".into()),
    ffz_channel: Some("name".into()),
    ..GuildEmotes::default()
  };
  assert_eq!(client.catalog(policy, &guild, None).await.len(), 7);
  assert_eq!(
    client
      .catalog(policy, &GuildEmotes::default(), None)
      .await
      .len(),
    4
  );
  let without_twitch_credentials = Arc::new(ProviderClient::new(None)?);
  let catalog = without_twitch_credentials
    .catalog(
      Providers {
        twitch: true,
        ..Providers::default()
      },
      &guild,
      None,
    )
    .await;
  assert!(catalog.is_empty(), "unexpected catalog emotes: {catalog:?}");
  let added = client
    .added(SEVEN_ID)
    .await?
    .context("missing added emote")?;
  assert!(added.added && added.overlaying);
  assert!(client.added("not-found").await?.is_none());
  assert!(
    bounded_bytes(client.http.get(http.origin.join("large")?).send().await?, 4)
      .await
      .is_err()
  );
  drop(http);
  assert_eq!(client.catalog(policy, &guild, None).await.len(), 7);
  let unavailable = client
    .cached(Feed::SevenTv, "https://7tv.io/invalid".into())
    .await;
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
        Ok(Json(json!([{"id":"valid","code":code,"animated":false}])))
      }
    }),
  ))
  .await?;
  let client = Arc::new(ProviderClient::new(None)?);
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
    let entries = client.cached(Feed::BetterTtv, url.clone()).await;
    assert_eq!(
      entries.first().map(|emote| emote.name.as_str()),
      Some(expected)
    );
    assert_eq!(
      &*client.cached(Feed::BetterTtv, url.clone()).await,
      &*entries
    );
    assert_eq!(requests.load(Ordering::Relaxed), attempt + 1);
  }
  Ok(())
}

#[tokio::test]
async fn slow_autocomplete_feeds_finish_one_shared_refresh_after_the_deadline() -> Result<()> {
  let requests = Arc::new(AtomicUsize::new(0));
  let release = Arc::new(tokio::sync::Notify::new());
  let server = TestServer::start(Router::new().route(
    "/3/cached/emotes/global",
    get({
      let requests = Arc::clone(&requests);
      let release = Arc::clone(&release);
      move || async move {
        requests.fetch_add(1, Ordering::Relaxed);
        release.notified().await;
        Json(json!([{"id":"valid","code":"SlowWave","animated":false}]))
      }
    }),
  ))
  .await?;
  let mut client = ProviderClient::new(None)?;
  client.test_origin = Some(server.origin.clone());
  let client = Arc::new(client);
  let policy = Providers {
    bttv: true,
    ..Providers::default()
  };
  let guild = GuildEmotes::default();
  let deadline = Some(Duration::from_millis(30));
  // Keep the server blocked until both callers have hit their deadlines.
  let (first, second) = tokio::join!(
    client.catalog(policy, &guild, deadline),
    client.catalog(policy, &guild, deadline)
  );
  assert!(first.is_empty() && second.is_empty());
  release.notify_one();
  let cached =
    tokio::time::timeout(Duration::from_secs(2), client.catalog(policy, &guild, None)).await?;
  assert_eq!(
    cached.first().map(|entry| entry.name.as_str()),
    Some("SlowWave")
  );
  assert_eq!(client.catalog(policy, &guild, deadline).await, cached);
  assert_eq!(requests.load(Ordering::Relaxed), 1);
  Ok(())
}
