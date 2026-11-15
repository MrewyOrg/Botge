//! Declares and registers Botge commands while preserving the Discord Activity entry point.

use anyhow::Result;
use serenity::{
  all::{
    Command, CommandOptionType, CommandType, InstallationContext, InteractionContext, Permissions,
  },
  builder::{CreateCommand, CreateCommandOption},
  http::Http,
};

use super::{NAMES, clear};

/// Creates a Discord text option with the common input length limit.
fn input(name: &str, description: &str) -> CreateCommandOption {
  CreateCommandOption::new(CommandOptionType::String, name, description).max_length(1000)
}

/// Returns the command definitions managed by this process.
fn definitions() -> Vec<CreateCommand> {
  let command = |name, description| {
    CreateCommand::new(name)
      .description(description)
      .contexts(vec![
        InteractionContext::Guild,
        InteractionContext::PrivateChannel,
        InteractionContext::BotDm,
      ])
  };
  let toggle =
    |name, description| CreateCommandOption::new(CommandOptionType::Boolean, name, description);
  vec![
    command(
      "emote-compose",
      "Send one emote or combine emotes, custom emoji, and Discord images",
    )
    .add_option(
      input(
        "emotes",
        "Space-separated emote names, custom emoji or Discord image URLs",
      )
      .required(true)
      .set_autocomplete(true),
    )
    .add_option(
      CreateCommandOption::new(
        CommandOptionType::Integer,
        "size",
        "Provider image scale (1–4; nearest available size)",
      )
      .min_int_value(1)
      .max_int_value(4)
      .set_autocomplete(true),
    )
    .add_option(toggle(
      "fullsize",
      "Use the largest provider scale (up to 4)",
    ))
    .add_option(toggle("stretch", "Stretch overlays to fill their column")),
    command(
      "emote-shortcuts",
      "Find the shortest unique name for each emote",
    )
    .add_option(
      input("emotes", "Space-separated emote names")
        .required(true)
        .set_autocomplete(true),
    ),
    command(
      clear::NAME,
      "Delete earlier unpinned messages in this channel after confirmation",
    )
    .contexts(vec![InteractionContext::Guild])
    .integration_types(vec![InstallationContext::Guild])
    .default_member_permissions(Permissions::ADMINISTRATOR),
  ]
}

/// Updates Botge's global commands and preserves Discord's Activity entry point.
///
/// Creates or updates every current definition before removing obsolete commands. A Discord
/// error stops the operation, so an earlier update or deletion can already have taken effect.
///
/// # Errors
///
/// Returns an error if a command cannot be read, created, updated, or removed. Earlier
/// successful registration changes remain applied.
pub(crate) async fn register(http: &Http) -> Result<()> {
  let existing = Command::get_global_commands(http).await?;
  for command in definitions() {
    Command::create_global_command(http, command).await?;
  }
  for command in existing {
    if command.kind != CommandType::PrimaryEntryPoint && !NAMES.contains(&command.name.as_str()) {
      Command::delete_global_command(http, command.id).await?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests;
