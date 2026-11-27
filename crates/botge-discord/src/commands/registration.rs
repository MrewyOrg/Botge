//! Declares and registers Botge commands while preserving the Discord Activity entry point.

use anyhow::Result;
use serenity::{
  all::{
    Command, CommandOptionType, CommandType, InstallationContext, InteractionContext, Permissions,
  },
  builder::{CreateCommand, CreateCommandOption},
  http::Http,
};

use super::{NAMES, clear, quantum};

/// Creates a Discord text option with the common input length limit.
fn input(name: &str, description: &str) -> CreateCommandOption {
  CreateCommandOption::new(CommandOptionType::String, name, description).max_length(1000)
}

/// Returns the definitions of the commands in `names`, in registration order.
fn definitions(names: &[&str]) -> Vec<CreateCommand> {
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
  let integer = |name, description, max| {
    CreateCommandOption::new(CommandOptionType::Integer, name, description)
      .min_int_value(1)
      .max_int_value(max)
  };
  [
    (
      NAMES[0],
      command(
        NAMES[0],
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
        integer(
          "size",
          "Provider image scale (1–4; nearest available size)",
          4,
        )
        .set_autocomplete(true),
      )
      .add_option(toggle(
        "fullsize",
        "Use the largest provider scale (up to 4)",
      ))
      .add_option(toggle("stretch", "Stretch overlays to fill their column")),
    ),
    (
      NAMES[1],
      command(NAMES[1], "Find the shortest unique name for each emote").add_option(
        input("emotes", "Space-separated emote names")
          .required(true)
          .set_autocomplete(true),
      ),
    ),
    (
      clear::NAME,
      command(
        clear::NAME,
        "Delete earlier unpinned messages in this channel after confirmation",
      )
      .contexts(vec![InteractionContext::Guild])
      .integration_types(vec![InstallationContext::Guild])
      .default_member_permissions(Permissions::ADMINISTRATOR),
    ),
    (
      quantum::NAME,
      command(
        quantum::NAME,
        "Draw a base emote and an overlay from one shot of a simulated quantum circuit",
      )
      .add_option(integer(
        "steps",
        "Coupling steps of the circuit (1–6, default 3)",
        6,
      ))
      .add_option(integer("size", "Provider image scale (1–4, default 2)", 4)),
    ),
  ]
  .into_iter()
  .filter_map(|(name, definition)| names.contains(&name).then_some(definition))
  .collect()
}

/// Updates Botge's global commands and preserves Discord's Activity entry point.
///
/// Creates or updates the definitions of `names` before removing every other command, so
/// `/quantum-emote` is removed when it is not among them. A Discord error stops the operation, so
/// an earlier update or deletion can already have taken effect.
///
/// # Errors
///
/// Returns an error if a command cannot be read, created, updated, or removed. Earlier
/// successful registration changes remain applied.
pub(super) async fn register(http: &Http, names: &[&str]) -> Result<()> {
  let existing = Command::get_global_commands(http).await?;
  for command in definitions(names) {
    Command::create_global_command(http, command).await?;
  }
  for command in existing {
    if command.kind != CommandType::PrimaryEntryPoint && !names.contains(&command.name.as_str()) {
      Command::delete_global_command(http, command.id).await?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests;
