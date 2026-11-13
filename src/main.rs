// Copyright (c) 2026 MrewyOrg. Licensed under the MIT license.
// See LICENSE.txt in the project root for license information.

//! Botge's process entry point and service lifecycle.
//!
//! Maintenance flags return before credentials or storage are loaded. Normal startup creates
//! shared services, then races the gateway, HTTP listeners, and shutdown signal; an exit from
//! any branch stops the workers and Discord shards.

// Songbird's async voice calls need a deeper Send trait check.
#![recursion_limit = "256"]

mod activity;
mod commands;
mod config;
mod discord;
mod emotes;
mod health;
mod proxy;
mod settings;
mod storage;
mod voice;

use std::{
  env,
  future::Future,
  net::{IpAddr, Ipv4Addr, SocketAddr},
  num::NonZeroU64,
  path::{Path, PathBuf},
  sync::Arc,
  time::Duration,
};

use anyhow::{Context as _, Result};
use reqwest::Url;
use serenity::{all::GatewayIntents, client::ClientBuilder, http::Http};
use songbird::{Config as VoiceConfig, SerenityInit as _, Songbird};
use tokio::{
  net::TcpListener,
  sync::{Notify, OnceCell, watch},
};
use tracing_subscriber::EnvFilter;

use crate::{
  discord::{DiscordAccess, Events},
  proxy::ProxyAuthenticator,
  storage::Store,
};

/// Runtime settings read once before the bot opens its database or connects to Discord.
struct Options {
  token: String,
  data: PathBuf,
  activity: Option<ActivityOptions>,
  twitch: Option<(String, String)>,
  cache: Option<Url>,
  register_commands: bool,
  prefix_compose: bool,
  health_address: SocketAddr,
}

/// Credentials and bind address for an enabled Activity API.
struct ActivityOptions {
  secret: String,
  public_key: String,
  application_id: NonZeroU64,
  address: SocketAddr,
}

impl Options {
  /// Validates environment values through a lookup that tests can supply without global state.
  ///
  /// The bot token is required. Supplying Activity credentials also requires an application
  /// ID and enables the Activity listener, which defaults to the loopback address on port 3080.
  /// Command registration and the message prefix are enabled only by the literal value `true`.
  fn read(get: impl Fn(&str) -> Option<String>) -> Result<Self> {
    let token = get("DISCORD_TOKEN")
      .filter(|value| !value.trim().is_empty())
      .context("DISCORD_TOKEN is required")?;
    let activity = match (
      get("DISCORD_ACTIVITY_CLIENT_SECRET"),
      get("DISCORD_ACTIVITY_PUBLIC_KEY"),
    ) {
      (None, None) => None,
      (Some(secret), Some(public_key)) if !secret.is_empty() => {
        let application_id = get("APP_ID")
          .and_then(|value| settings::discord_id(&value))
          .context("APP_ID must contain the Discord application ID")?;
        let host = get("ACTIVITY_BIND_HOST")
          .map(|host| host.parse::<IpAddr>())
          .transpose()
          .context("invalid ACTIVITY_BIND_HOST")?
          .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
        Some(ActivityOptions {
          secret,
          public_key,
          application_id,
          address: SocketAddr::new(host, 3080),
        })
      }
      _ => anyhow::bail!(
        "Activity requires both DISCORD_ACTIVITY_CLIENT_SECRET and DISCORD_ACTIVITY_PUBLIC_KEY"
      ),
    };
    Ok(Self {
      token,
      activity,
      data: get("BOTGE_DATA_DIR").map_or_else(|| PathBuf::from("data"), PathBuf::from),
      twitch: get("TWITCH_CLIENT_ID").zip(get("TWITCH_SECRET")),
      cache: get("LOCAL_CACHE_BASE")
        .map(|value| Url::parse(&value))
        .transpose()
        .context("invalid LOCAL_CACHE_BASE")?,
      register_commands: get("BOTGE_REGISTER_COMMANDS").as_deref() == Some("true"),
      prefix_compose: get("BOTGE_ENABLE_PREFIX_COMPOSE").as_deref() == Some("true"),
      health_address: SocketAddr::new(
        get("HEALTH_BIND_HOST")
          .map(|host| host.parse::<IpAddr>())
          .transpose()
          .context("invalid HEALTH_BIND_HOST")?
          .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        3081,
      ),
    })
  }
}

/// Selects one process-wide TLS provider before any client or background task is created.
fn initialize_tls() {
  // Reqwest and voice dependencies enable different providers; feature inference is ambiguous.
  // An existing selection is preserved if initialization is called more than once.
  let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

/// Handles maintenance flags before loading credentials; otherwise starts the bot services.
#[tokio::main]
async fn main() -> Result<()> {
  initialize_tls();
  if env::args().nth(1).as_deref() == Some("--verify-database") {
    let path = env::args()
      .nth(2)
      .context("--verify-database requires an offline backup path")?;
    return Store::verify_backup(Path::new(&path));
  }
  if env::args().nth(1).as_deref() == Some("--healthcheck") {
    return health::check("http://127.0.0.1:3081/readyz").await;
  }
  if env::args().nth(1).as_deref() == Some("--version") {
    println!("Botge {}", env!("CARGO_PKG_VERSION"));
    return Ok(());
  }
  tracing_subscriber::fmt()
    .with_env_filter(
      EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("botge=info")),
    )
    .init();
  let options = Options::read(|key| env::var(key).ok())?;
  let http = Http::new(&options.token);
  run(
    options,
    http,
    Path::new("botge.config.json"),
    shutdown_signal(),
  )
  .await
}

/// Starts the gateway, Activity API, and workers. Shuts them down on a service exit or signal.
///
/// Storage, configuration, and the optional listener are initialized before spawning workers.
/// Once running, the gateway, Activity listener, and shutdown future race. The first to finish
/// determines the result, and the worker tasks are stopped before the Discord shards shut down.
async fn run(
  options: Options,
  http: Http,
  config_path: &Path,
  shutdown: impl Future<Output = std::io::Result<()>>,
) -> Result<()> {
  std::fs::create_dir_all(&options.data).context("could not create the data directory")?;
  let store = Arc::new(Store::open(&options.data.join("botge.redb"))?);
  let config = config::Config::load(config_path)?;
  let emotes = Arc::new(emotes::Emotes::new(
    config.general,
    Arc::clone(&store),
    options.twitch,
  )?);
  let commands = commands::Commands::new(Arc::clone(&emotes), options.cache);
  let watch_sets = config.general.watches_seven_tv_sets();
  let voice_changed = Arc::new(Notify::new());
  let (ready, voice_ready) = watch::channel(false);
  let health_router = health::router(ready.subscribe());
  let health_listener = TcpListener::bind(options.health_address)
    .await
    .context("could not bind health listener")?;
  let songbird = Songbird::serenity_from_config(
    VoiceConfig::default()
      .gateway_timeout(Some(Duration::from_secs(10)))
      .driver_timeout(Some(Duration::from_secs(10))),
  );
  let mut discord = ClientBuilder::new_with_http(http, gateway_intents(options.prefix_compose))
    .event_handler(Events {
      ready,
      commands,
      register_commands: options.register_commands,
      registration: OnceCell::new(),
      voice_changed: Arc::clone(&voice_changed),
    })
    .register_songbird_with(Arc::clone(&songbird))
    .await?;
  let http = Arc::clone(&discord.http);
  let api = activity_server(
    options.activity,
    &http,
    Arc::clone(&store),
    Arc::clone(&emotes),
    Arc::clone(&voice_changed),
  )
  .await?;
  let shards = Arc::clone(&discord.shard_manager);
  let set_worker = watch_sets.then(|| tokio::spawn(async move { emotes.watch_sets().await }));
  let voice_worker = tokio::spawn(voice::reconcile(
    store,
    songbird,
    http,
    voice_changed,
    voice_ready,
  ));

  let result = tokio::select! {
      result = discord.start() => result.context("Discord gateway stopped"),
      result = serve_activity(api) => result.context("Activity API stopped"),
      result = axum::serve(health_listener, health_router) => result.context("Health listener stopped"),
      result = shutdown => result.context("could not listen for shutdown"),
  };
  voice_worker.abort();
  if let Some(worker) = set_worker {
    worker.abort();
  }
  shards.shutdown_all().await;
  result
}

/// Requests message content only when the operator enables prefix commands.
fn gateway_intents(prefix_compose: bool) -> GatewayIntents {
  let intents = GatewayIntents::GUILDS | GatewayIntents::GUILD_VOICE_STATES;
  if prefix_compose {
    intents
      | GatewayIntents::GUILD_MESSAGES
      | GatewayIntents::DIRECT_MESSAGES
      | GatewayIntents::MESSAGE_CONTENT
  } else {
    intents
  }
}

/// Binds the Activity listener when configured and returns it with the router.
///
/// An enabled listener needs a valid proxy key and the bot's Discord identity. Configuration,
/// identity lookup, or bind failures abort startup rather than silently disabling the API.
async fn activity_server(
  options: Option<ActivityOptions>,
  http: &Arc<Http>,
  store: Arc<Store>,
  emotes: Arc<emotes::Emotes>,
  voice_changed: Arc<Notify>,
) -> Result<Option<(TcpListener, axum::Router)>> {
  let Some(options) = options else {
    return Ok(None);
  };
  let proxy = ProxyAuthenticator::new(&options.public_key)?;
  let bot_user = http.get_current_user().await?.id;
  let access = DiscordAccess::new(
    options.application_id,
    options.secret,
    bot_user,
    Arc::clone(http),
  )?;
  let listener = TcpListener::bind(options.address).await?;
  Ok(Some((
    listener,
    activity::router(store, emotes, voice_changed, proxy, access),
  )))
}

/// Keeps the Activity branch pending when disabled so it cannot end the bot's service loop.
async fn serve_activity(api: Option<(TcpListener, axum::Router)>) -> std::io::Result<()> {
  let Some((listener, router)) = api else {
    return std::future::pending().await;
  };
  tracing::info!(address = %listener.local_addr()?, "Activity API listening");
  axum::serve(listener, router).await
}

/// Waits for Ctrl-C or, on Unix, the termination signal sent by container runtimes.
async fn shutdown_signal() -> std::io::Result<()> {
  #[cfg(unix)]
  {
    use tokio::signal::unix::{SignalKind, signal};
    let mut terminate = signal(SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result,
        _ = terminate.recv() => Ok(()),
    }
  }
  #[cfg(not(unix))]
  tokio::signal::ctrl_c().await
}

#[cfg(test)]
mod tests;
