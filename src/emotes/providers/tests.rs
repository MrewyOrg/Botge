//! Uses local provider responses to exercise normalization, cache expiry, and shared refreshes.

use std::sync::atomic::{AtomicUsize, Ordering};

use axum::{
  Json, Router,
  http::StatusCode,
  routing::{get, post},
};
use serde_json::{Value, json};

use super::*;
use crate::tests::TestServer;

pub(crate) const SEVEN_ID: &str = "01234567890123456789012345";

/// Builds a 7TV response with a fixed ID and both static and animated image variants.
pub(crate) fn seven_example(name: &str, animated: bool, flags: u32) -> Value {
  json!({
      "id": SEVEN_ID, "name": name, "animated": animated, "flags": flags,
      "host": { "files": [{ "name": "2x.png" }, { "name": "2x.gif" }] }
  })
}

#[test]
fn filters_unavailable_or_unsafe_provider_assets() -> Result<()> {
  for (id, name, listed) in [
    ("invalid-id", "Wave", true),
    (SEVEN_ID, " ", true),
    (SEVEN_ID, "Unlisted", false),
  ] {
    let mut entry: SevenEmote = serde_json::from_value(seven_example(name, false, 0))?;
    entry.id = id.into();
    entry.listed = Some(listed);
    assert!(entry.into_emote(None).is_none());
  }
  let set = json!({"emotes":[
      {"name": "SetAlias", "flags": 1, "data": seven_example("Original", true, 0)},
      {"name": "Hidden", "flags": 0, "data": seven_example("Hidden", false, 1)},
      {"name": "Unavailable", "flags": 0, "data": null}
  ]});
  let entries = parse_feed(Feed::SevenTv, &serde_json::to_vec(&set)?)?;
  assert_eq!(entries.len(), 1);
  let emote = entries.first().context("missing 7TV emote")?;
  assert_eq!(emote.name, "SetAlias");
  assert!(emote.overlaying && emote.animated && !emote.added);
  assert!(emote.image.ends_with(".gif"));

  let bttv = br#"[{"id":"bad/path","code":"Bad","animated":false},{"id":"valid","code":"Hi","animated":true}]"#;
  assert_eq!(
    parse_feed(Feed::BetterTtv, bttv)?
      .first()
      .map(|emote| emote.image.ends_with(".gif")),
    Some(true)
  );
  let ffz = br#"{"room":{"set":7},"sets":{"7":{"emoticons":[{"id":12,"name":"Hi","urls":{"1":"//cdn.frankerfacez.com/emote/12/1"}},{"id":13,"name":"Bad","urls":{"1":"https://other.example/image"}}]}}}"#;
  assert_eq!(parse_feed(Feed::Ffz, ffz)?.len(), 1);
  let global = br#"{"default_sets":[3,4],"sets":{"3":{"emoticons":[{"id":3,"name":"First","urls":{"1":"/emote/3/1"}}]},"4":{"emoticons":[{"id":4,"name":"Second","urls":{"1":"/emote/4/1"}}]},"5":{"emoticons":[{"id":5,"name":"Other","urls":{"1":"/emote/5/1"}}]}}}"#;
  let global = parse_feed(Feed::Ffz, global)?;
  assert_eq!(
    global
      .iter()
      .map(|emote| emote.name.as_str())
      .collect::<Vec<_>>(),
    ["First", "Second"]
  );
  let twitch = br#"{"data":[{"id":"valid","name":"Hi","format":["animated"]},{"id":"bad/path","name":"Bad","format":[]}]}"#;
  assert_eq!(
    parse_feed(Feed::Twitch, twitch)?
      .first()
      .map(|emote| emote.animated),
    Some(true)
  );
  assert!(parse_feed(Feed::BetterTtvChannel, b"bad").is_err());
  Ok(())
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
  assert!(
    without_twitch_credentials
      .catalog(
        Providers {
          twitch: true,
          ..Providers::default()
        },
        &guild,
        None
      )
      .await
      .is_empty()
  );
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

#[test]
fn retains_published_scales_and_falls_back_to_nearest_available() -> Result<()> {
  let mut seven = seven_example("Sizes", false, 0);
  *seven
    .get_mut("host")
    .and_then(|host| host.get_mut("files"))
    .context("missing files")? = json!([{"name":"1x.webp"}, {"name":"4x.webp"}]);
  let emote = serde_json::from_value::<SevenEmote>(seven)?
    .into_emote(None)
    .context("missing emote")?;
  assert!(emote.image_at(1).ends_with("1x.webp"));
  assert!(emote.image_at(2).ends_with("1x.webp"));
  assert!(emote.image_at(3).ends_with("4x.webp"));
  assert!(emote.image_at(4).ends_with("4x.webp"));
  let bttv = parse_feed(
    Feed::BetterTtv,
    br#"[{"id":"valid","code":"Hi","animated":true}]"#,
  )?;
  let emote = bttv.first().context("missing BTTV")?;
  assert!(emote.image_at(1).ends_with("1x.gif"));
  assert!(emote.image_at(4).ends_with("3x.gif"));
  let ffz = parse_feed(Feed::Ffz, br#"{"sets":{"3":{"emoticons":[{"id":12,"name":"Hi","urls":{"1":"/emote/12/1","4":"/emote/12/4","2":"https://evil.example/2"}}]}}}"#)?;
  let emote = ffz.first().context("missing FFZ")?;
  assert!(emote.image_at(2).ends_with("/1"));
  assert!(emote.image_at(3).ends_with("/4"));
  let twitch = parse_feed(
    Feed::Twitch,
    br#"{"data":[{"id":"valid","name":"Hi","format":["animated"],"scale":["1.0","3.0"]}]}"#,
  )?;
  let emote = twitch.first().context("missing Twitch")?;
  assert!(emote.image_at(2).ends_with("animated/dark/1.0"));
  assert!(emote.image_at(4).ends_with("animated/dark/3.0"));
  Ok(())
}
