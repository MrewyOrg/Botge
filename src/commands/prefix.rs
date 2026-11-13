// cspell:words rsplit

//! Handles attached `+emote` message shortcuts and their optional provider scale.

use std::num::NonZeroU64;

use anyhow::Result;
use serenity::{
  all::{Message, MessageType},
  builder::{CreateAllowedMentions, CreateAttachment, CreateMessage},
  http::Http,
};

use super::{Answer, Commands, compose::render_reply};
use crate::emotes::{rendering::Layer, valid_seven_id};

impl Commands {
  /// Handles `+emote` in human-authored messages and replies without pinging the author.
  ///
  /// Bot messages, webhooks, and non-conversation messages are ignored. The remainder
  /// after `+` uses the same renderer as the slash command and can end in a provider scale
  /// from 1 to 4.
  ///
  /// # Errors
  ///
  /// Returns an error if Discord cannot accept the reply. Input and render failures are sent as
  /// text; unrelated messages are ignored successfully.
  pub(crate) async fn respond_message(&self, http: &Http, message: &Message) -> Result<()> {
    if message.author.bot
      || message.webhook_id.is_some()
      || !matches!(
        message.kind,
        MessageType::Regular | MessageType::InlineReply
      )
    {
      return Ok(());
    }
    let Some(input) = prefix_input(&message.content) else {
      return Ok(());
    };
    let guild = message
      .guild_id
      .and_then(|guild| NonZeroU64::new(guild.get()));
    let answer = match prefix_size(input) {
      Ok((names, size)) => {
        render_reply(self.compose(
          names,
          guild,
          NonZeroU64::new(message.author.id.get()),
          size,
          false,
        ))
        .await
      }
      Err(message) => Answer::Text(message.into()),
    };
    let reply = CreateMessage::new()
      .reference_message(message)
      .allowed_mentions(CreateAllowedMentions::new().replied_user(false));
    let reply = match answer {
      Answer::Text(text) => reply.content(text),
      Answer::Image(image) => reply.add_file(CreateAttachment::bytes(image.bytes, image.filename)),
    };
    message.channel_id.send_message(http, reply).await?;
    Ok(())
  }
}

/// Recognizes a single leading `+` attached to the first emote token.
fn prefix_input(content: &str) -> Option<&str> {
  let input = content.strip_prefix('+')?;
  let first = input.chars().next()?;
  (!first.is_whitespace() && first != '+').then_some(input)
}

/// Reads a trailing `:size`, leaving Discord media and 7TV identifiers intact.
///
/// For example, `wave hat:3` returns `wave hat` with provider scale 3. A numeric suffix
/// outside 1–4 is an input error when it belongs to the size syntax.
///
/// # Examples
///
/// ```text
/// Wave Hat:3  -> names "Wave Hat", provider scale 3
/// <:Wave:42>  -> unchanged Discord emoji, no explicit provider scale
/// Wave:5      -> invalid provider scale
/// ```
///
/// # Errors
///
/// Returns an input error for a numeric size suffix outside 1–4 or one that overflows the size
/// type. Identifiers and image URLs without a size suffix retain their original interpretation.
fn prefix_size(input: &str) -> Result<(&str, Option<u16>), &'static str> {
  let input = input.trim_end();
  let Some((names, suffix)) = input.rsplit_once(':') else {
    return Ok((input, None));
  };
  if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
    return Ok((input, None));
  }
  let last_token = input.split_whitespace().next_back().unwrap_or_default();
  if last_token.strip_prefix("7tv:").is_some_and(valid_seven_id)
    || Layer::discord(last_token).is_some()
  {
    return Ok((input, None));
  }
  let size = suffix
    .parse::<u16>()
    .ok()
    .filter(|size| (1..=4).contains(size))
    .ok_or("Choose a provider size from 1 to 4.")?;
  Ok((names.trim_end(), Some(size)))
}

#[cfg(test)]
mod tests;
