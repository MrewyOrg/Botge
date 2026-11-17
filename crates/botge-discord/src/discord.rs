//! Adapts Discord gateway events and OAuth responses to Botge's commands and Activity API.
//!
//! [`OAuthClient`] groups one application's identity and secret. [`DiscordAccess`] shares a
//! bounded transport and keeps each Activity request cheap. Guilds and members come from the
//! gateway cache, which the `GUILDS` and privileged `GUILD_MEMBERS` intents keep current, so
//! their changes apply at once. A member the cache lacks is fetched over REST and reused for
//! [`MEMBER_CACHE_TTL`]. The account behind a token is identified when Botge exchanges the code
//! and reused for [`IDENTITY_CACHE_TTL`], so a revoked token stops working within that window.
//! Denials (a rejected token or a non-member) are reused for
//! [`DENIAL_CACHE_TTL`], so repeated attempts do not add to Discord's invalid-request limit;
//! other failures are never cached. When Discord rate-limits an OAuth call, OAuth calls pause
//! until its retry window ends. OAuth transport/decode failures are
//! sanitized before they reach logs or HTTP responses. Gateway callbacks route interactions
//! to commands and notify the voice worker when readiness changes.

use std::{
  collections::HashMap,
  hash::{BuildHasher as _, Hash, RandomState},
  num::NonZeroU64,
  sync::{Arc, Mutex, OnceLock, PoisonError},
  time::{Duration, Instant},
};

use reqwest::StatusCode;
use serde::Deserialize;
use serenity::{
  all::{
    ActivityData, ChannelType, Context, EventHandler, Guild, GuildId, Interaction, Member, Message,
    Permissions, Ready, UserId,
  },
  async_trait,
  cache::Cache,
  http::Http,
};
use tokio::sync::{Notify, watch};

use botge_app::access::{
  AccessError as ApiError, AccessToken, Credential, FailureKind, GuildAccess, GuildRole,
  Membership, VoiceChannel,
};

use crate::commands::{self, Commands};
use botge_domain::settings::discord_id;

/// OAuth application identity configured together to avoid mismatched constructor arguments.
pub struct OAuthClient {
  /// The configured Discord application ID.
  pub application_id: NonZeroU64,
  /// The OAuth client secret, never logged or persisted.
  pub secret: String,
}

/// Text Botge shows as "Watching …" on its Discord profile.
pub const STATUS: &str = "github.com/MrewyOrg/Botge";

/// Builds the watching status sent when the gateway identifies, so every connection shows it.
#[must_use]
pub fn presence() -> ActivityData {
  ActivityData::watching(STATUS)
}

/// How long a member record fetched over REST is reused.
pub const MEMBER_CACHE_TTL: Duration = Duration::from_secs(30);
/// How long the account behind an Activity access token is reused without asking Discord.
///
/// A token revoked on Discord's side, or stolen and then revoked, stops working within this
/// window. Membership and roles are checked on every request regardless.
pub const IDENTITY_CACHE_TTL: Duration = Duration::from_mins(5);
/// How long a denial is reused, capped by the window of the record it replaces.
///
/// Discord temporarily blocks a client IP after too many 401, 403 and 429 answers, so repeated
/// requests from someone who is denied are answered locally for a short time.
pub const DENIAL_CACHE_TTL: Duration = Duration::from_secs(10);
/// The longest OAuth pause taken from a rate-limit answer; longer requests are cut to this.
const MAX_OAUTH_PAUSE: Duration = Duration::from_secs(60);
/// Answers requests for a guild the gateway has not delivered yet.
const STARTING: ApiError = ApiError(
  FailureKind::Upstream,
  "Botge is still connecting to Discord. Try again shortly.",
);
/// Member records and token identities kept at once.
const USER_CACHE_LIMIT: usize = 4096;

/// A bounded map whose entries expire a fixed time after they were stored.
///
/// When an insert finds the map full, expired entries are dropped first, then every entry.
struct Expiring<K, V> {
  entries: Mutex<HashMap<K, (Instant, V)>>,
  limit: usize,
}

impl<K: Eq + Hash, V: Clone> Expiring<K, V> {
  fn new(limit: usize) -> Self {
    Self {
      entries: Mutex::new(HashMap::new()),
      limit,
    }
  }

  /// Returns the value stored for `key` less than `ttl(value)` ago.
  fn get(&self, key: &K, ttl: impl FnOnce(&V) -> Duration) -> Option<V> {
    let now = Instant::now();
    self
      .entries
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .get(key)
      .filter(|(stored, value)| now.duration_since(*stored) < ttl(value))
      .map(|(_, value)| value.clone())
  }

  /// Stores `value`, replacing any earlier entry for `key`.
  fn insert(&self, key: K, value: V, ttl: Duration) {
    let now = Instant::now();
    let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
    if entries.len() >= self.limit {
      entries.retain(|_, (stored, _)| now.duration_since(*stored) < ttl);
      if entries.len() >= self.limit {
        entries.clear();
      }
    }
    entries.insert(key, (now, value));
  }
}

/// Exchanges Activity authorization codes and uses the bot client to check guild permissions.
pub struct DiscordAccess {
  application_id: NonZeroU64,
  secret: String,
  bot_user: UserId,
  http: Arc<Http>,
  // Shared connection settings only; credentials belong to individual requests.
  transport: &'static reqwest::Client,
  /// Members the gateway cache lacks; `None` records that the user is not a member.
  members: Expiring<(GuildId, UserId), Option<Arc<Member>>>,
  member_ttl: Duration,
  /// Accounts keyed by a keyed hash of the access token; the token itself is not kept.
  /// `None` records that Discord rejected the token.
  identities: Expiring<u64, Option<UserId>>,
  token_hasher: RandomState,
  identity_ttl: Duration,
  /// When the current OAuth rate-limit pause ends.
  oauth_paused_until: Mutex<Option<Instant>>,
  /// The gateway cache of guilds, channels, roles and members.
  gateway: Arc<Cache>,
  /// Whether the gateway has delivered its guild list since connecting.
  ready: watch::Receiver<bool>,
}

/// The gateway cache and readiness a [`DiscordAccess`] reads guilds from.
#[derive(Debug)]
pub struct Gateway {
  /// Kept current by the `GUILDS` and privileged `GUILD_MEMBERS` intents.
  pub cache: Arc<Cache>,
  /// True once the gateway is ready; guilds it lists then arrive shortly after.
  pub ready: watch::Receiver<bool>,
}

/// Reports the caller's administrator status and, for administrators, the selectable roles.
fn membership_in(guild: &Guild, member: &Member) -> Membership {
  let administrator = guild.member_permissions(member).administrator();
  let mut roles = Vec::new();
  if administrator {
    // Exclude @everyone and integration-managed roles from the selectable roles.
    roles.extend(
      guild
        .roles
        .values()
        .filter(|role| role.id.get() != guild.id.get() && !role.managed),
    );
    roles.sort_unstable_by_key(|role| (std::cmp::Reverse(role.position), role.id));
  }
  Membership {
    administrator,
    roles: member.roles.iter().map(ToString::to_string).collect(),
    available_roles: roles
      .into_iter()
      .map(|role| GuildRole {
        id: role.id.to_string(),
        name: role.name.clone(),
      })
      .collect(),
  }
}

/// Lists the voice channels Botge can view and join, sorted as Discord shows them.
///
/// # Errors
///
/// Returns a forbidden error unless `member` administers the guild.
fn voice_choices(
  guild: &Guild,
  member: &Member,
  bot: &Member,
) -> Result<Vec<VoiceChannel>, ApiError> {
  if !guild.member_permissions(member).administrator() {
    return Err(ApiError::FORBIDDEN);
  }
  // Evaluate the bot's channel-specific permissions, including Discord overrides.
  let mut channels: Vec<_> = guild
    .channels
    .values()
    .filter(|channel| {
      channel.kind == ChannelType::Voice
        && guild
          .user_permissions_in(channel, bot)
          .contains(Permissions::VIEW_CHANNEL | Permissions::CONNECT)
    })
    .collect();
  channels.sort_unstable_by_key(|channel| (channel.position, channel.id));
  Ok(
    channels
      .into_iter()
      .map(|channel| VoiceChannel {
        id: channel.id.to_string(),
        name: channel.name.clone(),
      })
      .collect(),
  )
}

impl DiscordAccess {
  /// Creates the OAuth client and reads guilds from the gateway cache.
  ///
  /// # Errors
  ///
  /// Returns an error if the shared Discord HTTP client cannot be initialized.
  pub fn new(
    oauth: OAuthClient,
    bot_user: UserId,
    http: Arc<Http>,
    gateway: Gateway,
  ) -> anyhow::Result<Self> {
    let transport = discord_client()?;
    Ok(Self {
      application_id: oauth.application_id,
      secret: oauth.secret,
      bot_user,
      http,
      transport,
      members: Expiring::new(USER_CACHE_LIMIT),
      member_ttl: MEMBER_CACHE_TTL,
      identities: Expiring::new(USER_CACHE_LIMIT),
      token_hasher: RandomState::new(),
      identity_ttl: IDENTITY_CACHE_TTL,
      oauth_paused_until: Mutex::new(None),
      gateway: gateway.cache,
      ready: gateway.ready,
    })
  }

  /// How long a cached lookup is reused: its full window when found, a short one when denied.
  fn window<T>(window: Duration, value: Option<&T>) -> Duration {
    if value.is_some() {
      window
    } else {
      window.min(DENIAL_CACHE_TTL)
    }
  }

  /// Runs `read` on the gateway's copy of `id`.
  ///
  /// # Errors
  ///
  /// Returns a starting error while the gateway is not ready or has not delivered the guild
  /// yet, and a membership denial for a guild Botge is not in.
  fn read_guild<R>(&self, id: GuildId, read: impl FnOnce(&Guild) -> R) -> Result<R, ApiError> {
    if let Some(guild) = self.gateway.guild(id) {
      return Ok(read(&guild));
    }
    let starting = !*self.ready.borrow() || self.gateway.unavailable_guilds().get(&id).is_some();
    Err(if starting {
      STARTING
    } else {
      ApiError::NOT_MEMBER
    })
  }

  /// Returns a member from the gateway cache, or over REST when the cache lacks them.
  ///
  /// A REST copy is reused for [`MEMBER_CACHE_TTL`] and a denial for [`DENIAL_CACHE_TTL`].
  /// Concurrent misses may fetch twice; the last response is kept.
  ///
  /// # Errors
  ///
  /// Returns a membership denial, cached or fresh, or an uncached upstream error.
  async fn member(&self, guild: GuildId, user: UserId) -> Result<Arc<Member>, ApiError> {
    if let Some(member) = self.read_guild(guild, |cached| cached.members.get(&user).cloned())? {
      return Ok(Arc::new(member));
    }
    let key = (guild, user);
    let window = self.member_ttl;
    if let Some(member) = self
      .members
      .get(&key, |member| Self::window(window, member.as_ref()))
    {
      return member.ok_or(ApiError::NOT_MEMBER);
    }
    match guild
      .member(&self.http, user)
      .await
      .map_err(guild_access_error)
    {
      Ok(member) => {
        let member = Arc::new(member);
        self.members.insert(key, Some(Arc::clone(&member)), window);
        Ok(member)
      }
      Err(error) => {
        if error.0 == FailureKind::PermissionDenied {
          self.members.insert(key, None, window);
        }
        Err(error)
      }
    }
  }

  /// Exchanges one code for an access token and its lifetime.
  ///
  /// # Errors
  ///
  /// An expired or rejected code prompts the Activity to authorize again. A rejected OAuth
  /// client is reported separately so the operator can check the application ID and secret.
  /// Other Discord request or decoding failures surface as upstream errors.
  async fn exchange_code(&self, code: &str) -> Result<AccessToken, ApiError> {
    #[derive(Deserialize)]
    struct Token {
      access_token: String,
      expires_in: u64,
    }
    let application_id = self.application_id.to_string();
    let request = self
      .transport
      .post("https://discord.com/api/v10/oauth2/token")
      .form(&[
        ("client_id", application_id.as_str()),
        ("client_secret", self.secret.as_str()),
        ("grant_type", "authorization_code"),
        ("code", code),
      ])
      .build()
      .map_err(oauth_error)?;
    let response = self.send_oauth(request).await?;
    if matches!(
      response.status(),
      StatusCode::BAD_REQUEST | StatusCode::UNAUTHORIZED
    ) {
      /// OAuth error code used to distinguish invalid credentials from an expired grant.
      #[derive(Deserialize)]
      struct Rejection {
        error: String,
      }
      let status = response.status();
      let reason = response
        .json::<Rejection>()
        .await
        .ok()
        .map(|reply| reply.error);
      if status == StatusCode::UNAUTHORIZED || reason.as_deref() == Some("invalid_client") {
        tracing::warn!(%status, message = "Discord rejected the Activity OAuth client");
        return Err(ApiError::OAUTH_CONFIGURATION);
      }
      tracing::warn!(%status, expired = reason.as_deref() == Some("invalid_grant"), message = "Discord rejected the Activity OAuth code");
      return Err(ApiError::UNAUTHORIZED);
    }
    let token: Token = response
      .error_for_status()
      .map_err(oauth_error)?
      .json()
      .await
      .map_err(oauth_error)?;
    // Identify the new token now, so the first request made with it needs no identity call. A
    // failure here leaves that request to identify it instead.
    if let Ok(Some(user)) = self.fetch_identity(&token.access_token).await {
      let key = self.token_hasher.hash_one(&token.access_token);
      self.identities.insert(key, Some(user), self.identity_ttl);
    }
    Ok(AccessToken {
      access_token: token.access_token,
      expires_in: token.expires_in,
    })
  }

  /// Resolves the account behind an access token.
  ///
  /// The account is reused for [`IDENTITY_CACHE_TTL`] after Discord confirms it, here or in
  /// [`Self::exchange_code`], and a rejection for [`DENIAL_CACHE_TTL`]. Entries are keyed by a
  /// keyed hash of the token, so a revoked token is rejected once its window ends. A 64-bit keyed
  /// hash makes a collision between two live tokens negligible, and callers cannot choose tokens
  /// that collide.
  ///
  /// # Errors
  ///
  /// Returns an authorization error for a revoked token or invalid identity; transport, HTTP,
  /// and response-decoding failures are mapped to client-safe API errors.
  async fn identify(&self, credential: &Credential) -> Result<UserId, ApiError> {
    let key = self.token_hasher.hash_one(credential.token());
    let window = self.identity_ttl;
    if let Some(user) = self
      .identities
      .get(&key, |user| Self::window(window, user.as_ref()))
    {
      return user.ok_or(ApiError::UNAUTHORIZED);
    }
    let user = self.fetch_identity(credential.token()).await?;
    self.identities.insert(key, user, window);
    user.ok_or(ApiError::UNAUTHORIZED)
  }

  /// Asks Discord which account owns `token`; `None` means Discord rejected the token.
  ///
  /// # Errors
  ///
  /// Returns an authorization error for an invalid account ID, and client-safe errors for
  /// transport, HTTP, and response-decoding failures.
  async fn fetch_identity(&self, token: &str) -> Result<Option<UserId>, ApiError> {
    #[derive(Deserialize)]
    struct Identity {
      id: String,
    }
    let request = self
      .transport
      .get("https://discord.com/api/v10/users/@me")
      .bearer_auth(token)
      .build()
      .map_err(oauth_error)?;
    let response = self.send_oauth(request).await?;
    if response.status() == StatusCode::UNAUTHORIZED {
      return Ok(None);
    }
    let user: Identity = response
      .error_for_status()
      .map_err(oauth_error)?
      .json()
      .await
      .map_err(oauth_error)?;
    discord_id(&user.id)
      .map(|id| Some(UserId::new(id.get())))
      .ok_or(ApiError::UNAUTHORIZED)
  }

  /// Sends a request built from a fixed Discord endpoint, using loopback fixtures in tests.
  ///
  /// A 429 answer pauses every OAuth call for its `Retry-After` seconds, at least one second and
  /// at most [`MAX_OAUTH_PAUSE`]. Calls made during the pause fail without contacting Discord.
  /// The pause is shared because each token is identified at most once per identity window, so a
  /// 429 here reflects Botge's address or application rather than one user.
  ///
  /// # Errors
  ///
  /// Returns a rate-limit error during a pause or for a 429 answer, and a sanitized upstream
  /// error if the request fails. Other response statuses are interpreted by the caller.
  async fn send_oauth(&self, request: reqwest::Request) -> Result<reqwest::Response, ApiError> {
    let paused = *self
      .oauth_paused_until
      .lock()
      .unwrap_or_else(PoisonError::into_inner);
    if paused.is_some_and(|until| Instant::now() < until) {
      return Err(ApiError::RATE_LIMITED);
    }
    #[cfg(any(test, feature = "test-util"))]
    let request = crate::test_support::redirect_oauth(request, self.http.proxy.as_deref())?;
    let response = self.transport.execute(request).await.map_err(oauth_error)?;
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
      let pause = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<f64>().ok())
        .and_then(|seconds| Duration::try_from_secs_f64(seconds).ok())
        .unwrap_or(MAX_OAUTH_PAUSE)
        .clamp(Duration::from_secs(1), MAX_OAUTH_PAUSE);
      tracing::warn!(
        pause_seconds = pause.as_secs_f64(),
        message = "Discord rate-limited an OAuth request"
      );
      *self
        .oauth_paused_until
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Some(Instant::now() + pause);
      return Err(ApiError::RATE_LIMITED);
    }
    Ok(response)
  }
}

/// Shares one bounded, non-redirecting Discord transport independently of request state.
///
/// Concurrent first calls may each build a client, but only the first one stored is kept and
/// returned to every caller; configuration errors propagate.
///
/// # Errors
///
/// Returns the HTTP-client construction error; a failed initialization does not publish a
/// partial client and a later call can retry.
fn discord_client() -> Result<&'static reqwest::Client, reqwest::Error> {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  if let Some(client) = CLIENT.get() {
    return Ok(client);
  }
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(10))
    .redirect(reqwest::redirect::Policy::none())
    .build()?;
  Ok(CLIENT.get_or_init(|| client))
}

/// Keeps OAuth transport and decoding errors out of logs because they may contain credentials.
fn oauth_error(_error: reqwest::Error) -> ApiError {
  ApiError::upstream("Discord OAuth request failed")
}

impl GuildAccess for DiscordAccess {
  async fn exchange_code(&self, code: &str) -> Result<AccessToken, ApiError> {
    self.exchange_code(code).await
  }

  /// Resolves the OAuth caller without requesting guild details.
  ///
  /// # Errors
  ///
  /// Returns credential, Discord transport, or identity-decoding errors from `identify`.
  async fn user_id(&self, credential: &Credential) -> Result<NonZeroU64, ApiError> {
    NonZeroU64::new(self.identify(credential).await?.get()).ok_or(ApiError::UNAUTHORIZED)
  }

  /// Fetches the caller's membership and returns role choices only to administrators.
  ///
  /// # Errors
  ///
  /// Returns credential errors or failures reading the current guild and member. Missing
  /// or inaccessible Discord records become membership-denial errors.
  async fn membership(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Membership, ApiError> {
    let user = self.identify(credential).await?;
    let guild = GuildId::new(guild.get());
    let member = self.member(guild, user).await?;
    self.read_guild(guild, |cached| membership_in(cached, &member))
  }

  /// Lists voice channels where Botge has both View Channel and Connect permissions.
  ///
  /// # Errors
  ///
  /// Returns an error for invalid credentials, insufficient administrator access, or failed
  /// Discord guild or member lookups.
  async fn voice_channels(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Vec<VoiceChannel>, ApiError> {
    let user = self.identify(credential).await?;
    let guild = GuildId::new(guild.get());
    let (member, bot) =
      tokio::try_join!(self.member(guild, user), self.member(guild, self.bot_user))?;
    self.read_guild(guild, |cached| voice_choices(cached, &member, &bot))?
  }
}

/// Maps inaccessible guild or member records to the Activity's membership error.
fn guild_access_error(error: serenity::Error) -> ApiError {
  if matches!(&error, serenity::Error::Http(http) if http.status_code().is_some_and(|code| matches!(code.as_u16(), 403 | 404)))
  {
    return ApiError::NOT_MEMBER;
  }
  ApiError::upstream(error)
}

/// Gateway callbacks and the shared state used to start or reconcile workers.
#[derive(Debug)]
pub struct Events {
  /// Interaction and prefix command adapter.
  pub commands: Commands,
  /// Whether Ready events may register managed commands.
  pub register_commands: bool,
  /// Records the first successful registration. A failed attempt can retry on a later Ready event.
  pub registration: tokio::sync::OnceCell<()>,
  /// Gateway readiness shared with health and background workers.
  pub ready: watch::Sender<bool>,
  /// Wakes voice reconciliation after gateway events.
  pub voice_changed: Arc<Notify>,
}

impl Events {
  /// Invalidates readiness during reconnects; only Ready or Resumed may restore it.
  fn set_gateway_stage(&self, stage: serenity::gateway::ConnectionStage) {
    if stage != serenity::gateway::ConnectionStage::Connected {
      self.ready.send_replace(false);
    }
  }
}

#[async_trait]
impl EventHandler for Events {
  /// Signals readiness and attempts global registration if the operator enabled it.
  async fn ready(&self, ctx: Context, data_about_bot: Ready) {
    tracing::info!(user = %data_about_bot.user.id, message = "Discord gateway ready");
    self.ready.send_replace(true);
    self.voice_changed.notify_one();
    if self.register_commands
      && let Err(error) = self
        .registration
        .get_or_try_init(|| commands::register(&ctx.http))
        .await
    {
      tracing::error!(%error, message = "could not register Discord commands");
    }
  }

  /// Dispatches supported interactions and logs reply failures at the gateway boundary.
  async fn interaction_create(&self, ctx: Context, interaction: Interaction) {
    let result = match interaction {
      Interaction::Command(command) => self.commands.respond(&ctx.http, command).await,
      Interaction::Autocomplete(command) => self.commands.autocomplete(&ctx.http, command).await,
      Interaction::Modal(modal) => self.commands.modal(&ctx.http, modal).await,
      _ => return,
    };
    if let Err(error) = result {
      tracing::warn!(%error, message = "could not respond to interaction");
    }
  }

  /// Passes gateway messages through the prefix reply handler.
  async fn message(&self, ctx: Context, new_message: Message) {
    if let Err(error) = self.commands.respond_message(&ctx.http, &new_message).await {
      tracing::warn!(%error, message = "could not reply to emote message");
    }
  }

  /// Wakes voice reconciliation after a gateway resume.
  async fn resume(&self, _context: Context, _event: serenity::all::ResumedEvent) {
    self.ready.send_replace(true);
    self.voice_changed.notify_one();
  }

  /// Removes readiness while the single gateway shard reconnects; Ready/Resumed restores it.
  async fn shard_stage_update(
    &self,
    _context: Context,
    event: serenity::gateway::ShardStageUpdateEvent,
  ) {
    self.set_gateway_stage(event.new);
  }
}

#[cfg(test)]
impl DiscordAccess {
  /// Changes how long REST members are reused, so tests can force a fresh fetch.
  const fn set_member_ttl(&mut self, ttl: Duration) {
    self.member_ttl = ttl;
  }

  /// Changes how long token identities are reused, so tests can force a fresh lookup.
  const fn set_identity_ttl(&mut self, ttl: Duration) {
    self.identity_ttl = ttl;
  }
}

#[cfg(test)]
mod tests;

impl std::fmt::Debug for OAuthClient {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("OAuthClient")
      .field("application_id", &self.application_id)
      .finish_non_exhaustive()
  }
}

impl std::fmt::Debug for DiscordAccess {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("DiscordAccess")
      .field("application_id", &self.application_id)
      .finish_non_exhaustive()
  }
}
