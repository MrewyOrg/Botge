//! Loads provider feeds and serves cached snapshots during refreshes or upstream outages.
//!
//! Callers share a refresh per feed URL. A shorter caller deadline can fall back to a cached
//! snapshot without cancelling that refresh. Provider-specific JSON stays in this module,
//! and callers receive validated [`Emote`] values. Each record keeps its usable image scales;
//! the default catalog image is nearest to scale 2, with a smaller-scale tie break.

mod events;
mod normalization;

use normalization::parse_feed;

use std::{
  collections::HashMap,
  sync::Arc,
  time::{Duration, Instant},
};

use anyhow::{Context as _, Result};
use futures_util::future::join_all;
#[cfg(test)]
use reqwest::Url;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, de::DeserializeOwned};
use tokio::sync::{Mutex, watch};

use super::{Emote, GuildEmotes, valid_seven_id};
use crate::config::Providers;

const MAX_PAYLOAD: usize = 4 * 1024 * 1024;
const REFRESH: Duration = Duration::from_mins(15);
const MAX_REFRESHES: usize = 16;

// Share each snapshot as a slice. Refreshes replace the whole snapshot.
type Snapshot = Arc<[Emote]>;
type Refresh = watch::Receiver<Option<Snapshot>>;

/// One feed's last usable response and its refresh deadline.
struct Cached {
  emotes: Snapshot,
  expires: Instant,
  /// The 7TV set ID used to subscribe to changes for this feed, when available.
  set_id: Option<String>,
}

/// Selects the parser and any authentication required by a provider endpoint.
#[derive(Clone, Copy)]
enum Feed {
  SevenTv,
  BetterTtv,
  BetterTtvChannel,
  Ffz,
  Twitch,
}

/// Shares HTTP connections, provider snapshots, and in-flight refreshes across callers.
///
/// `cache` holds the last published snapshot for each URL. `refreshing` coordinates waiters
/// for ongoing fetches. When both locks are needed, acquire `refreshing` before `cache`.
/// Network requests run outside those locks.
pub(super) struct ProviderClient {
  http: Client,
  cache: Mutex<HashMap<String, Cached>>,
  refreshing: Mutex<HashMap<String, Refresh>>,
  twitch: Option<(String, String)>,
  #[cfg(test)]
  pub(super) test_origin: Option<Url>,
}

impl ProviderClient {
  /// Configures bounded requests and disables redirects on the shared HTTP client.
  ///
  /// # Errors
  ///
  /// Returns an error if the shared bounded HTTP client cannot be constructed.
  pub(super) fn new(twitch: Option<(String, String)>) -> Result<Self> {
    Ok(Self {
      http: Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Botge")
        .build()?,
      cache: Mutex::new(HashMap::new()),
      refreshing: Mutex::new(HashMap::new()),
      twitch,
      #[cfg(test)]
      test_origin: None,
    })
  }

  /// Borrows the client so callers can reuse its connections and request policy.
  pub(super) const fn http(&self) -> &Client {
    &self.http
  }

  /// Starts a request using the production endpoint or the test fixture.
  fn get(&self, url: &str) -> reqwest::RequestBuilder {
    self.http.get(self.endpoint(url))
  }

  /// In tests, maps a provider path to the fixture's origin.
  #[cfg_attr(
    not(test),
    expect(
      clippy::unused_self,
      reason = "Test builds use the client-specific loopback origin"
    )
  )]
  fn endpoint(&self, url: &str) -> String {
    #[cfg(test)]
    if let Some(origin) = &self.test_origin
      && let Ok(url) = Url::parse(url)
      && let Ok(path) = origin.join(url.path())
    {
      return path.to_string();
    }
    url.to_owned()
  }

  /// Looks up one emote and checks that the returned ID matches the request.
  ///
  /// A 404 or unusable record returns `Ok(None)`. Transport, HTTP, and decoding failures
  /// are reported to the caller. This lookup reads the provider directly.
  ///
  /// # Errors
  ///
  /// Returns transport, non-404 HTTP, body-limit, and JSON decoding errors. A missing,
  /// ID-mismatched, or unusable record produces `Ok(None)`.
  pub(super) async fn added(&self, id: &str) -> Result<Option<Emote>> {
    let response = self
      .get(&format!("https://7tv.io/v3/emotes/{id}"))
      .send()
      .await?;
    if response.status() == StatusCode::NOT_FOUND {
      return Ok(None);
    }
    let bytes = bounded_bytes(response, MAX_PAYLOAD).await?;
    normalization::parse_added(&bytes, id)
  }

  /// Combines enabled feeds in catalog order, with stale snapshots available on timeout.
  ///
  /// Guild-specific feeds are placed before global feeds. Fetches run concurrently but
  /// collection keeps that order so callers can use the first match as the preferred emote.
  /// If a feed exceeds `timeout`, it contributes its last snapshot or an empty list.
  pub(super) async fn catalog(
    self: &Arc<Self>,
    policy: Providers,
    settings: &GuildEmotes,
    timeout: Option<Duration>,
  ) -> Vec<Emote> {
    let mut sources = Vec::new();
    if policy.seven_personal
      && let Some(id) = &settings.seven_tv_set
    {
      sources.push((Feed::SevenTv, format!("https://7tv.io/v3/emote-sets/{id}")));
    }
    if policy.bttv
      && let Some(id) = &settings.bttv_twitch_id
    {
      sources.push((
        Feed::BetterTtvChannel,
        format!("https://api.betterttv.net/3/cached/users/twitch/{id}"),
      ));
    }
    if policy.ffz
      && let Some(channel) = &settings.ffz_channel
    {
      sources.push((
        Feed::Ffz,
        format!("https://api.frankerfacez.com/v1/room/{channel}"),
      ));
    }
    if policy.seven_global {
      sources.push((Feed::SevenTv, "https://7tv.io/v3/emote-sets/global".into()));
    }
    if policy.bttv {
      sources.push((
        Feed::BetterTtv,
        "https://api.betterttv.net/3/cached/emotes/global".into(),
      ));
    }
    if policy.ffz {
      sources.push((
        Feed::Ffz,
        "https://api.frankerfacez.com/v1/set/global".into(),
      ));
    }
    if policy.twitch && self.twitch.is_some() {
      sources.push((
        Feed::Twitch,
        "https://api.twitch.tv/helix/chat/emotes/global".into(),
      ));
    }

    join_all(sources.into_iter().map(|(feed, url)| async move {
      if let Some(timeout) = timeout {
        match tokio::time::timeout(timeout, self.cached(feed, url.clone())).await {
          Ok(emotes) => emotes,
          Err(_) => self
            .cache
            .lock()
            .await
            .get(&url)
            .map_or_else(|| Arc::from([]), |entry| Arc::clone(&entry.emotes)),
        }
      } else {
        self.cached(feed, url).await
      }
    }))
    .await
    .into_iter()
    .flat_map(|emotes| emotes.to_vec())
    .collect()
  }

  /// Reuses a fresh snapshot or joins the refresh already running for this URL.
  ///
  /// At the refresh limit, a URL without a refresh in flight gets its previous snapshot
  /// immediately, or an empty snapshot if it has never been loaded. Otherwise a background
  /// task publishes the refresh to all waiters.
  async fn cached(self: &Arc<Self>, feed: Feed, url: String) -> Snapshot {
    let mut refresh = {
      let mut refreshing = self.refreshing.lock().await;
      let cache = self.cache.lock().await;
      let entry = cache.get(&url);
      if let Some(entry) = entry.filter(|entry| entry.expires > Instant::now()) {
        return Arc::clone(&entry.emotes);
      }
      if let Some(refresh) = refreshing.get(&url) {
        drop(cache);
        refresh.clone()
      } else {
        if refreshing.len() >= MAX_REFRESHES {
          return entry.map_or_else(|| Arc::from([]), |entry| Arc::clone(&entry.emotes));
        }
        drop(cache);
        let (sender, refresh) = watch::channel(None);
        refreshing.insert(url.clone(), refresh.clone());
        drop(refreshing);
        let client = Arc::clone(self);
        // Autocomplete can time out without cancelling the shared refresh.
        tokio::spawn(async move {
          let snapshot = client.refresh(feed, &url).await;
          client.refreshing.lock().await.remove(&url);
          sender.send_replace(Some(snapshot));
        });
        refresh
      }
    };
    refresh
      .wait_for(Option::is_some)
      .await
      .ok()
      .and_then(|snapshot| snapshot.clone())
      .unwrap_or_else(|| Arc::from([]))
  }

  /// Publishes a replacement snapshot and retries failed feeds sooner using their last good data.
  ///
  /// A failed first load publishes an empty snapshot. When admitting a new URL to a full
  /// cache, evicts the entry with the earliest expiry.
  async fn refresh(&self, feed: Feed, url: &str) -> Snapshot {
    let result = self.fetch(feed, url).await;
    let mut cache = self.cache.lock().await;
    let (emotes, set_id, ttl) = match result {
      Ok((emotes, set_id)) => (Arc::from(emotes), set_id, REFRESH),
      Err(error) => {
        tracing::warn!(%error, "could not refresh emote provider");
        let (stale, id) = cache.get(url).map_or_else(
          || (Arc::from([]), None),
          |entry| (Arc::clone(&entry.emotes), entry.set_id.clone()),
        );
        (stale, id, Duration::from_secs(60))
      }
    };
    if cache.len() >= 64
      && !cache.contains_key(url)
      && let Some(oldest) = cache
        .iter()
        .min_by_key(|(_, value)| value.expires)
        .map(|(key, _)| key.clone())
    {
      cache.remove(&oldest);
    }
    cache.insert(
      url.to_owned(),
      Cached {
        emotes: Arc::clone(&emotes),
        expires: Instant::now() + ttl,
        set_id,
      },
    );
    emotes
  }

  /// Fetches a feed and returns its normalized entries and optional 7TV set ID.
  ///
  /// Twitch requests obtain an application access token before fetching the emotes. The set
  /// ID is extracted only for 7TV and lets the event worker subscribe to changes for the feed.
  ///
  /// # Errors
  ///
  /// Returns an error for missing Twitch credentials, failed token or feed requests,
  /// oversized bodies, or malformed feed metadata.
  async fn fetch(&self, feed: Feed, url: &str) -> Result<(Vec<Emote>, Option<String>)> {
    /// Minimal response used to associate a feed with its WebSocket subscription.
    #[derive(Deserialize)]
    struct SetId {
      id: Option<String>,
    }

    let request = self.get(url);
    let response = if matches!(feed, Feed::Twitch) {
      let (id, secret) = self
        .twitch
        .as_ref()
        .context("Twitch credentials are missing")?;
      let token: TwitchToken = decode(
        self
          .http
          .post(self.endpoint("https://id.twitch.tv/oauth2/token"))
          .form(&[
            ("client_id", id.as_str()),
            ("client_secret", secret.as_str()),
            ("grant_type", "client_credentials"),
          ])
          .send()
          .await?,
      )
      .await?;
      request
        .header("Client-Id", id)
        .bearer_auth(token.access_token)
        .send()
        .await?
    } else {
      request.send().await?
    };
    let bytes = bounded_bytes(response, MAX_PAYLOAD).await?;
    let id = if matches!(feed, Feed::SevenTv) {
      serde_json::from_slice::<SetId>(&bytes)?
        .id
        .filter(|id| valid_seven_id(id))
    } else {
      None
    };
    Ok((parse_feed(feed, &bytes)?, id))
  }
}

/// Deserializes JSON after reading the response within the provider byte limit.
///
/// # Errors
///
/// Returns HTTP, response-size, body-read, or deserialization errors from the bounded response.
async fn decode<T: DeserializeOwned>(response: reqwest::Response) -> Result<T> {
  Ok(serde_json::from_slice(
    &bounded_bytes(response, MAX_PAYLOAD).await?,
  )?)
}

/// Enforces a byte limit both on the advertised length and as body chunks arrive.
///
/// # Errors
///
/// Rejects HTTP error responses before reading the body. Returns an error if a read fails
/// or if the next chunk would exceed `limit`, including responses without a content length.
pub(super) async fn bounded_bytes(
  mut response: reqwest::Response,
  limit: usize,
) -> Result<Vec<u8>> {
  response = response.error_for_status()?;
  anyhow::ensure!(
    response
      .content_length()
      .is_none_or(|size| size <= limit as u64),
    "provider response too large"
  );
  let mut output = Vec::new();
  while let Some(chunk) = response.chunk().await? {
    anyhow::ensure!(
      output.len() + chunk.len() <= limit,
      "provider response too large"
    );
    output.extend_from_slice(&chunk);
  }
  Ok(output)
}

/// The application access token returned by Twitch's client credentials exchange.
#[derive(Deserialize)]
struct TwitchToken {
  access_token: String,
}

#[cfg(test)]
pub(crate) mod tests;
