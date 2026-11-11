//! Adapts Discord gateway events and OAuth responses to Botge's commands and Activity API.

use std::{
  num::NonZeroU64,
  sync::{Arc, OnceLock},
  time::Duration,
};

use reqwest::StatusCode;
use serde::Deserialize;
use serenity::{
  all::{
    ChannelType, Context, EventHandler, GuildId, Interaction, Message, Permissions, Ready, UserId,
  },
  async_trait,
  http::Http,
};
use tokio::sync::{Notify, watch};

use crate::{
  activity::{ApiError, GuildAccess, GuildRole, Membership, VoiceChannel},
  commands::{self, Commands},
  settings::discord_id,
};

/// Exchanges Activity authorization codes and uses the bot client to check guild permissions.
pub(crate) struct DiscordAccess {
  application_id: NonZeroU64,
  secret: String,
  bot_user: UserId,
  http: Arc<Http>,
}

impl DiscordAccess {
  /// Creates the OAuth client and shares the bot HTTP client for guild queries.
  pub(crate) fn new(
    application_id: NonZeroU64,
    secret: String,
    bot_user: UserId,
    http: Arc<Http>,
  ) -> anyhow::Result<Self> {
    discord_client()?;
    Ok(Self {
      application_id,
      secret,
      bot_user,
      http,
    })
  }

  /// Exchanges one code and asks Discord which account it belongs to.
  ///
  /// # Errors
  ///
  /// An expired or rejected code prompts the Activity to authorize again. A rejected OAuth
  /// client is reported separately so the operator can check the application ID and secret.
  /// Other Discord request or decoding failures surface as upstream errors.
  async fn identify(&self, code: &str) -> Result<UserId, ApiError> {
    /// Access token needed for the identity request.
    #[derive(Deserialize)]
    struct Token {
      access_token: String,
    }

    /// Minimal response from Discord's current-user endpoint.
    #[derive(Deserialize)]
    struct Identity {
      id: String,
    }

    let client = discord_client().map_err(oauth_error)?;
    let application_id = self.application_id.to_string();
    let request = client
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
        tracing::warn!(%status, "Discord rejected the Activity OAuth client");
        return Err(ApiError::OAUTH_CONFIGURATION);
      }
      tracing::warn!(%status, expired = reason.as_deref() == Some("invalid_grant"), "Discord rejected the Activity OAuth code");
      return Err(ApiError::UNAUTHORIZED);
    }
    let token: Token = response
      .error_for_status()
      .map_err(oauth_error)?
      .json()
      .await
      .map_err(oauth_error)?;
    let request = client
      .get("https://discord.com/api/v10/users/@me")
      .bearer_auth(token.access_token)
      .build()
      .map_err(oauth_error)?;
    let response = self.send_oauth(request).await?;
    if response.status() == StatusCode::UNAUTHORIZED {
      return Err(ApiError::UNAUTHORIZED);
    }
    let user: Identity = response
      .error_for_status()
      .map_err(oauth_error)?
      .json()
      .await
      .map_err(oauth_error)?;
    discord_id(&user.id)
      .map(|id| UserId::new(id.get()))
      .ok_or(ApiError::UNAUTHORIZED)
  }

  /// Sends a request built from a fixed Discord endpoint, using loopback fixtures in tests.
  async fn send_oauth(&self, request: reqwest::Request) -> Result<reqwest::Response, ApiError> {
    #[cfg(test)]
    let request = tests::redirect_oauth(request, self.http.proxy.as_deref())?;
    discord_client()
      .map_err(oauth_error)?
      .execute(request)
      .await
      .map_err(oauth_error)
  }
}

/// Shares one bounded, non-redirecting Discord transport independently of request state.
/// Concurrent initialization retains one client and propagates configuration errors.
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
  /// Resolves the OAuth caller without requesting guild details.
  async fn user_id(&self, code: &str) -> Result<NonZeroU64, ApiError> {
    NonZeroU64::new(self.identify(code).await?.get()).ok_or(ApiError::UNAUTHORIZED)
  }

  /// Fetches the caller's membership and returns role choices only to administrators.
  async fn membership(&self, guild: NonZeroU64, code: &str) -> Result<Membership, ApiError> {
    let user = self.identify(code).await?;
    let guild_id = GuildId::new(guild.get());
    let (guild, member) = tokio::try_join!(
      guild_id.to_partial_guild(&self.http),
      guild_id.member(&self.http, user)
    )
    .map_err(guild_access_error)?;
    let administrator = guild.member_permissions(&member).administrator();
    let mut roles = Vec::new();
    if administrator {
      // Exclude @everyone and integration-managed roles from the selectable roles.
      roles.extend(
        guild
          .roles
          .values()
          .filter(|role| role.id.get() != guild_id.get() && !role.managed),
      );
      roles.sort_unstable_by_key(|role| (std::cmp::Reverse(role.position), role.id));
    }
    Ok(Membership {
      administrator,
      roles: member.roles.iter().map(ToString::to_string).collect(),
      available_roles: roles
        .into_iter()
        .map(|role| GuildRole {
          id: role.id.to_string(),
          name: role.name.clone(),
        })
        .collect(),
    })
  }

  /// Lists voice channels where Botge has both View Channel and Connect permissions.
  async fn voice_channels(
    &self,
    guild: NonZeroU64,
    code: &str,
  ) -> Result<Vec<VoiceChannel>, ApiError> {
    let user = self.identify(code).await?;
    let guild_id = GuildId::new(guild.get());
    let (guild, member) = tokio::try_join!(
      guild_id.to_partial_guild(&self.http),
      guild_id.member(&self.http, user)
    )
    .map_err(guild_access_error)?;
    if !guild.member_permissions(&member).administrator() {
      return Err(ApiError::FORBIDDEN);
    }

    let (channels, bot) = tokio::try_join!(
      guild_id.channels(&self.http),
      guild_id.member(&self.http, self.bot_user)
    )
    .map_err(guild_access_error)?;
    // Evaluate the bot's channel-specific permissions, including Discord overrides.
    let mut channels: Vec<_> = channels
      .into_values()
      .filter(|channel| {
        channel.kind == ChannelType::Voice
          && guild
            .user_permissions_in(channel, &bot)
            .contains(Permissions::VIEW_CHANNEL | Permissions::CONNECT)
      })
      .collect();
    channels.sort_unstable_by_key(|channel| (channel.position, channel.id));
    Ok(
      channels
        .into_iter()
        .map(|channel| VoiceChannel {
          id: channel.id.to_string(),
          name: channel.name,
        })
        .collect(),
    )
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
pub(crate) struct Events {
  pub(crate) commands: Commands,
  pub(crate) register_commands: bool,
  /// Records the first successful registration. A failed attempt can retry on a later Ready event.
  pub(crate) registration: tokio::sync::OnceCell<()>,
  pub(crate) ready: watch::Sender<bool>,
  pub(crate) voice_changed: Arc<Notify>,
}

#[async_trait]
impl EventHandler for Events {
  /// Signals readiness and attempts global registration if the operator enabled it.
  async fn ready(&self, context: Context, ready: Ready) {
    tracing::info!(user = %ready.user.id, "Discord gateway ready");
    self.ready.send_replace(true);
    self.voice_changed.notify_one();
    if self.register_commands
      && let Err(error) = self
        .registration
        .get_or_try_init(|| commands::register(&context.http))
        .await
    {
      tracing::error!(%error, "could not register Discord commands");
    }
  }

  /// Dispatches supported interactions and logs reply failures at the gateway boundary.
  async fn interaction_create(&self, context: Context, interaction: Interaction) {
    let result = match interaction {
      Interaction::Command(command) => self.commands.respond(&context.http, command).await,
      Interaction::Autocomplete(command) => {
        self.commands.autocomplete(&context.http, command).await
      }
      Interaction::Modal(modal) => self.commands.modal(&context.http, modal).await,
      _ => return,
    };
    if let Err(error) = result {
      tracing::warn!(%error, "could not respond to interaction");
    }
  }

  /// Passes gateway messages through the prefix reply handler.
  async fn message(&self, context: Context, message: Message) {
    if let Err(error) = self.commands.respond_message(&context.http, &message).await {
      tracing::warn!(%error, "could not reply to emote message");
    }
  }

  /// Wakes voice reconciliation after a gateway resume.
  async fn resume(&self, _context: Context, _event: serenity::all::ResumedEvent) {
    self.voice_changed.notify_one();
  }
}

#[cfg(test)]
pub(crate) mod tests;
