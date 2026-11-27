//! Dispatches Discord commands through shared catalog and render state.
//!
//! `compose` resolves and renders inputs, `prefix` handles attached `+emote` messages,
//! `autocomplete` and `shortcuts` perform name matching, and `registration` owns the
//! command definitions. `clear` contains the separate message-cleanup workflow, and `quantum`
//! the `/quantum-emote` command that exists only with a configured sidecar.

mod autocomplete;
mod clear;
mod compose;
mod prefix;
mod quantum;
mod registration;
mod shortcuts;

use std::{num::NonZeroU64, sync::Arc};

use anyhow::Result;
use reqwest::Url;
use serenity::{
  all::{CommandDataOption, CommandDataOptionValue, CommandInteraction, ModalInteraction},
  builder::{CreateAllowedMentions, CreateAttachment, EditInteractionResponse},
  http::Http,
};

use botge_app::Application;
use botge_quantum::QuantumClient;

use compose::render_reply;
use shortcuts::shortcuts;

/// Commands registered in every deployment; `/quantum-emote` follows them when configured.
const NAMES: [&str; 3] = ["emote-compose", "emote-shortcuts", clear::NAME];

/// Dispatches Discord interactions and shares one render slot across reply paths.
#[derive(Debug)]
pub struct Commands {
  application: Arc<Application>,
  cache: Option<Url>,
  quantum: Option<QuantumClient>,
}

use botge_app::Composition as Answer;

impl Commands {
  /// Shares the catalog and optional cache URL across slash and message replies.
  #[must_use]
  pub const fn new(application: Arc<Application>, cache: Option<Url>) -> Self {
    Self {
      application,
      cache,
      quantum: None,
    }
  }

  /// Enables `/quantum-emote`, which draws through `client`'s sidecar.
  #[must_use]
  pub fn with_quantum(mut self, client: QuantumClient) -> Self {
    self.quantum = Some(client);
    self
  }

  /// Names of the commands this process registers and answers, in registration order.
  fn names(&self) -> impl Iterator<Item = &'static str> {
    NAMES
      .into_iter()
      .chain(self.quantum.as_ref().map(|_| quantum::NAME))
  }

  /// Updates Botge's global commands, including `/quantum-emote` only when it is configured.
  ///
  /// # Errors
  ///
  /// Returns the Discord failures described by [`registration::register`].
  pub(crate) async fn register(&self, http: &Http) -> Result<()> {
    registration::register(http, &self.names().collect::<Vec<_>>()).await
  }

  /// Defers emote replies while rendering. The clear command opens its confirmation modal directly.
  ///
  /// # Errors
  ///
  /// Returns Discord HTTP errors while acknowledging, opening a confirmation, or editing a reply.
  /// Rendering and input failures are converted to reply text by `render_reply`; quantum draw
  /// failures are sent as ephemeral followups.
  pub async fn respond(&self, http: &Http, command: CommandInteraction) -> Result<()> {
    if !self.names().any(|name| name == command.data.name) {
      return Ok(());
    }
    self.application.metrics().command(&command.data.name);
    if command.data.name == clear::NAME {
      return clear::open(http, &command).await;
    }
    command.defer(http).await?;
    if let Some(client) = &self.quantum
      && command.data.name == quantum::NAME
    {
      return self.respond_quantum(http, &command, client).await;
    }
    let guild = command
      .guild_id
      .and_then(|guild| NonZeroU64::new(guild.get()));
    let answer = render_reply(self.answer(
      &command.data.name,
      &command.data.options,
      guild,
      NonZeroU64::new(command.user.id.get()),
    ))
    .await;
    let response = EditInteractionResponse::new().allowed_mentions(CreateAllowedMentions::new());
    let response = match answer {
      Answer::Text(text) => response.content(text),
      Answer::Image(image) if image.bytes.len() > command.attachment_size_limit as usize => response
        .content("The rendered image exceeds Discord's upload limit for this interaction. Try a smaller size."),
      Answer::Image(image) => {
        response.new_attachment(CreateAttachment::bytes(image.bytes, image.filename))
      }
    };
    command.edit_response(http, response).await?;
    Ok(())
  }

  /// Routes confirmation modals to the clear-message handler.
  ///
  /// # Errors
  ///
  /// Propagates the Discord and deletion failures from `clear::confirm`.
  pub async fn modal(&self, http: &Http, modal: ModalInteraction) -> Result<()> {
    clear::confirm(http, modal).await
  }

  /// Builds an answer from slash command options without sending it to Discord.
  ///
  /// # Errors
  ///
  /// Returns catalog, preference, download, or rendering failures. Invalid user input is
  /// represented by [`Answer::Text`] without sending a Discord response.
  async fn answer(
    &self,
    command: &str,
    options: &[CommandDataOption],
    guild: Option<NonZeroU64>,
    user: Option<NonZeroU64>,
  ) -> Result<Answer> {
    match command {
      "emote-shortcuts" => {
        let emotes = self.application.catalog(guild).await?;
        let input = string(options, "emotes").unwrap_or_default().to_owned();
        // Ambiguous catalogs can require many substring comparisons. Keep that CPU work
        // off gateway/API executor threads while retaining shared snapshot ownership.
        let reply = tokio::task::spawn_blocking(move || shortcuts(&emotes, &input)).await?;
        Ok(Answer::Text(reply))
      }
      "emote-compose" => {
        let Some(input) = string(options, "emotes") else {
          return Ok(Answer::Text(
            "Enter emote names or Discord image links.".into(),
          ));
        };
        let size = match option(options, "size") {
          Some(CommandDataOptionValue::Integer(size)) => {
            let Ok(size @ 1..=4) = u16::try_from(*size) else {
              return Ok(Answer::Text("Choose a provider size from 1 to 4.".into()));
            };
            Some(size)
          }
          _ => flag(options, "fullsize").then_some(4),
        };
        let fit = if flag(options, "stretch") {
          botge_app::Fit::Stretch
        } else {
          botge_app::Fit::Natural
        };
        self.compose(input, guild, user, size, fit).await
      }
      _ => Ok(Answer::Text("This command is unavailable.".into())),
    }
  }
}

/// Looks up the value Discord sent for a named option.
fn option<'a>(options: &'a [CommandDataOption], name: &str) -> Option<&'a CommandDataOptionValue> {
  options
    .iter()
    .find(|option| option.name == name)
    .map(|option| &option.value)
}

/// Returns the option only when Discord supplied a string.
fn string<'a>(options: &'a [CommandDataOption], name: &str) -> Option<&'a str> {
  match option(options, name) {
    Some(CommandDataOptionValue::String(value)) => Some(value.as_str()),
    _ => None,
  }
}

/// Reads an optional boolean option, defaulting to `false`.
fn flag(options: &[CommandDataOption], name: &str) -> bool {
  matches!(
    option(options, name),
    Some(CommandDataOptionValue::Boolean(true))
  )
}

#[cfg(test)]
mod tests;
