//! Dispatches Discord commands through shared catalog and render state.
//!
//! [`compose`] resolves and renders inputs, [`prefix`] handles attached `+emote` messages,
//! [`autocomplete`] and [`mod@shortcuts`] perform name matching, and [`registration`] owns the
//! command definitions. [`clear`] contains the separate message-cleanup workflow.

mod autocomplete;
mod clear;
mod compose;
mod prefix;
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
use tokio::sync::Semaphore;

use crate::emotes::{Emotes, rendering};

use compose::render_reply;
pub(crate) use registration::register;
use shortcuts::shortcuts;

const NAMES: [&str; 3] = ["emote-compose", "emote-shortcuts", clear::NAME];

/// Dispatches Discord interactions and shares one render slot across reply paths.
pub(crate) struct Commands {
  emotes: Arc<Emotes>,
  cache: Option<Url>,
  render_slot: Semaphore,
}

/// A text reply or rendered attachment before Discord-specific formatting.
enum Answer {
  Text(String),
  Image(rendering::Image),
}

impl Commands {
  /// Shares the catalog and optional cache URL across slash and message replies.
  pub(crate) fn new(emotes: Arc<Emotes>, cache: Option<Url>) -> Self {
    Self {
      emotes,
      cache,
      render_slot: Semaphore::new(1),
    }
  }

  /// Defers emote replies while rendering. The clear command opens its confirmation modal directly.
  ///
  /// # Errors
  ///
  /// Returns Discord HTTP errors while acknowledging, opening a confirmation, or editing a reply.
  /// Rendering and input failures are converted to reply text by [`render_reply`].
  pub(crate) async fn respond(&self, http: &Http, command: CommandInteraction) -> Result<()> {
    if !NAMES.contains(&command.data.name.as_str()) {
      return Ok(());
    }
    if command.data.name == clear::NAME {
      return clear::open(http, &command).await;
    }
    command.defer(http).await?;
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
  /// Propagates the Discord and deletion failures from [`clear::confirm`].
  pub(crate) async fn modal(&self, http: &Http, modal: ModalInteraction) -> Result<()> {
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
        let emotes = self.emotes.catalog(guild).await?;
        Ok(Answer::Text(shortcuts(
          &emotes,
          string(options, "emotes").unwrap_or_default(),
        )))
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
        self
          .compose(input, guild, user, size, flag(options, "stretch"))
          .await
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
