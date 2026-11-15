//! Loopback servers, media and log fixtures used only by workspace tests.

#![expect(
  clippy::missing_errors_doc,
  reason = "Fixture failures propagate to the owning test"
)]

use anyhow::{Context as _, Result};
use axum::Router;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use botge_domain::emotes::{Emote, Source};
use reqwest::Url;
use serde_json::{Value, json};
use serenity::http::Http;

use std::sync::Arc;
use tokio::{net::TcpListener, task::JoinHandle};

/// Captures tracing output from isolated test tasks.
#[derive(Clone, Debug, Default)]
pub struct TestLogs(Arc<std::sync::Mutex<Vec<u8>>>);

impl TestLogs {
  /// Returns an owned subscriber that can move into a spawned task independently of this handle.
  #[must_use]
  pub fn subscriber(&self) -> impl tracing::Subscriber + Send + Sync + use<> {
    let writer = self.clone();
    tracing_subscriber::fmt()
      .without_time()
      .with_ansi(false)
      .with_max_level(tracing::Level::TRACE)
      .with_writer(move || writer.clone())
      .finish()
  }
  /// Returns complete UTF-8 output accumulated by this fixture.
  pub fn text(&self) -> Result<String> {
    let bytes = self
      .0
      .lock()
      .map_err(|_error| anyhow::anyhow!("fixture log lock poisoned"))?
      .clone();
    Ok(String::from_utf8(bytes)?)
  }
}

impl std::io::Write for TestLogs {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    self
      .0
      .lock()
      .map_err(|_error| std::io::Error::other("fixture log lock poisoned"))?
      .extend_from_slice(buf);
    Ok(buf.len())
  }
  fn flush(&mut self) -> std::io::Result<()> {
    Ok(())
  }
}

/// Owns a loopback HTTP server and cancels it on drop.
#[derive(Debug)]
pub struct TestServer {
  /// Base URL bound to a temporary loopback port.
  pub origin: Url,
  task: JoinHandle<()>,
}

impl TestServer {
  /// Binds the router to an ephemeral loopback port and returns its base URL.
  pub async fn start(router: Router) -> Result<Self> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = Url::parse(&format!("http://{}", listener.local_addr()?))?;
    let task = tokio::spawn(async move {
      drop(axum::serve(listener, router).await);
    });
    Ok(Self { origin, task })
  }
}

impl Drop for TestServer {
  fn drop(&mut self) {
    self.task.abort();
  }
}

/// Builds a Discord user fixture. ID `42` represents Botge itself.
#[must_use]
pub fn user(id: &str) -> Value {
  json!({ "id": id, "username": "Fixture", "bot": id == "42" })
}

/// Points Serenity's REST client at the local fixture and disables its rate limiter.
#[must_use]
pub fn http_for(server: &TestServer) -> Http {
  serenity::http::HttpBuilder::new("fixture")
    .proxy(server.origin.as_str())
    .ratelimiter_disabled(true)
    .application_id(serenity::all::ApplicationId::new(42))
    .build()
}

/// Decodes the shared one-pixel PNG used by media routes and renderer assertions.
pub fn png_pixel() -> Result<Vec<u8>> {
  Ok(STANDARD.decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XioAAAAASUVORK5CYII=",
  )?)
}

/// Reads PNG width and height without tying assertions to raw header byte offsets.
pub fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
  anyhow::ensure!(
    bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
    "expected PNG fixture"
  );
  let dimension = |offset| -> Result<u32> {
    Ok(u32::from_be_bytes(
      *bytes
        .get(offset..)
        .and_then(<[u8]>::first_chunk::<4>)
        .context("missing PNG dimension")?,
    ))
  };
  Ok((dimension(16)?, dimension(20)?))
}

/// Builds a static 7TV addition with a production-shaped CDN URL for fixture tests.
#[must_use]
pub fn example(name: &str, id: &str) -> Emote {
  Emote {
    id: id.into(),
    name: name.into(),
    source: Source::SevenTv,
    image: format!("https://cdn.7tv.app/emote/{id}/2x.png"),
    sizes: std::collections::BTreeMap::default(),
    animated: false,
    overlaying: false,
    tags: Vec::new(),
    added: true,
  }
}

/// A stable provider fixture identifier.
pub const SEVEN_ID: &str = "01234567890123456789012345";

/// Builds a 7TV response with a fixed ID and both static and animated image variants.
#[must_use]
pub fn seven_example(name: &str, animated: bool, flags: u32) -> Value {
  json!({
      "id": SEVEN_ID, "name": name, "animated": animated, "flags": flags,
      "host": { "files": [{ "name": "2x.png" }, { "name": "2x.gif" }] }
  })
}

/// A legacy log backend for checking diagnostics before any tracing subscriber is installed.
struct LegacyLogger(TestLogs);

impl log::Log for LegacyLogger {
  fn enabled(&self, _metadata: &log::Metadata<'_>) -> bool {
    true
  }
  fn log(&self, record: &log::Record<'_>) {
    use std::io::Write as _;
    drop(writeln!(
      self.0.clone(),
      "{} {}",
      record.level(),
      record.args()
    ));
  }
  fn flush(&self) {}
}

/// Runs one test in a fresh process and captures the legacy logging fallback there.
///
/// Returns `None` to the parent after the child succeeds and `Some(logs)` in the child.
/// Tracing remembers whether a subscriber has ever been installed, so this fixture cannot be
/// reproduced by dropping a scoped subscriber in an ordinary concurrent test process.
pub fn legacy_logging_fixture(test: &str) -> Result<Option<TestLogs>> {
  static LOGGER: std::sync::LazyLock<LegacyLogger> =
    std::sync::LazyLock::new(|| LegacyLogger(TestLogs::default()));

  if std::env::var("BOTGE_LEGACY_LOG_TEST").as_deref() != Ok(test) {
    let output = std::process::Command::new(std::env::current_exe()?)
      .args(["--exact", test, "--nocapture"])
      .env("BOTGE_LEGACY_LOG_TEST", test)
      .output()?;
    anyhow::ensure!(
      output.status.success() && String::from_utf8_lossy(&output.stdout).contains("1 passed;"),
      "isolated logging fixture failed: {}",
      String::from_utf8_lossy(&output.stderr)
    );
    return Ok(None);
  }
  log::set_logger(&*LOGGER)
    .map_err(|error| anyhow::anyhow!("legacy logger setup failed: {error}"))?;
  log::set_max_level(log::LevelFilter::Trace);
  Ok(Some(LOGGER.0.clone()))
}

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(test)]
mod tests;
