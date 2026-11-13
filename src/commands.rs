// cspell:words rsplit

//! Discord command registration, autocomplete, and response rendering.

mod clear;

use std::{collections::HashSet, future::Future, num::NonZeroU64, sync::Arc, time::Duration};

use anyhow::Result;
use reqwest::Url;
use serenity::{
  all::{
    Command, CommandDataOption, CommandDataOptionValue, CommandInteraction, CommandOptionType,
    CommandType, InstallationContext, InteractionContext, Message, MessageType, ModalInteraction,
    Permissions,
  },
  builder::{
    CreateAllowedMentions, CreateAttachment, CreateAutocompleteResponse, CreateCommand,
    CreateCommandOption, CreateInteractionResponse, CreateMessage, EditInteractionResponse,
  },
  http::Http,
};
use tokio::sync::Semaphore;

use crate::emotes::{
  Emote, Emotes, find_emote,
  rendering::{self, Layer, RenderOptions},
  valid_seven_id,
};

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

  /// Handles `+emote` in human-authored messages and replies without pinging the author.
  ///
  /// Bot messages, webhooks, and non-conversation messages are ignored. The remainder
  /// after `+` uses the same renderer as the slash command and can end in a provider scale
  /// from 1 to 4.
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

  /// Routes confirmation modals to the clear-message handler.
  pub(crate) async fn modal(&self, http: &Http, modal: ModalInteraction) -> Result<()> {
    clear::confirm(http, modal).await
  }

  /// Returns size or emote choices. If the lookup exceeds its deadline, sends an empty list.
  pub(crate) async fn autocomplete(&self, http: &Http, command: CommandInteraction) -> Result<()> {
    let Some(focused) = command.data.autocomplete() else {
      return Ok(());
    };
    let mut response = CreateAutocompleteResponse::new();
    match (command.data.name.as_str(), focused.name) {
      ("emote-compose", "size") => {
        for size in [1, 2, 3, 4] {
          let label = size.to_string();
          if label.starts_with(focused.value) {
            response = response.add_int_choice(label, size);
          }
        }
      }
      ("emote-compose" | "emote-shortcuts", "emotes") => {
        let guild = command
          .guild_id
          .and_then(|guild| NonZeroU64::new(guild.get()));
        if let Ok(Ok(emotes)) = tokio::time::timeout(
          Duration::from_secs(2),
          self.emotes.catalog_for_autocomplete(guild),
        )
        .await
        {
          for value in suggestions(&emotes, focused.value) {
            response = response.add_string_choice(value.clone(), value);
          }
        }
      }
      _ => {}
    }
    command
      .create_response(http, CreateInteractionResponse::Autocomplete(response))
      .await?;
    Ok(())
  }

  /// Looks up a border only when the reply has an associated user.
  async fn border(&self, user: Option<NonZeroU64>) -> Result<Option<u32>> {
    let Some(user) = user else {
      return Ok(None);
    };
    self.emotes.border_for_user(user).await
  }

  /// Builds an answer from slash command options without sending it to Discord.
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

  /// Resolves one token without changing the catalog or persisted guild additions.
  ///
  /// Explicit IDs fetch current 7TV metadata. Named additions saved without variants are
  /// refreshed for this render, retaining their saved overlay flag. Discord media is a fallback
  /// only when no catalog entry matches.
  async fn resolve_layer(
    &self,
    catalog: &[Emote],
    token: &str,
    scale: u16,
  ) -> Result<Option<Layer>> {
    if let Some(id) = token.strip_prefix("7tv:") {
      return Ok(
        self
          .emotes
          .fetch_added(id)
          .await?
          .as_ref()
          .and_then(|emote| Layer::emote_at(emote, scale)),
      );
    }
    let Some(emote) = find_emote(catalog, token) else {
      return Ok(Layer::discord(token));
    };
    if emote.sizes.is_empty() && emote.added && valid_seven_id(&emote.id) {
      return Ok(
        self
          .emotes
          .fetch_added(&emote.id)
          .await?
          .as_ref()
          .and_then(|fresh| {
            let mut layer = Layer::emote_at(fresh, scale)?;
            layer.overlay = emote.overlaying;
            Some(layer)
          }),
      );
    }
    Ok(Layer::emote_at(emote, scale))
  }

  /// Resolves the input in order and holds a render permit through the download and composition.
  ///
  /// A `7tv:` token resolves by ID when individual 7TV additions are enabled. Other tokens
  /// resolve against the catalog or Discord media syntax. If any token is unavailable,
  /// the reply identifies that token and skips the render. A single input without a border
  /// is sent as the selected provider variant's original attachment. Scale defaults to 2;
  /// the renderer receives native-size layers rather than the command's provider scale.
  async fn compose(
    &self,
    input: &str,
    guild: Option<NonZeroU64>,
    user: Option<NonZeroU64>,
    scale: Option<u16>,
    stretch: bool,
  ) -> Result<Answer> {
    let mut tokens: Vec<_> = input.split_whitespace().take(33).collect();
    if tokens.is_empty() || tokens.len() > 32 {
      return Ok(Answer::Text("Enter between 1 and 32 emotes.".into()));
    }
    let Ok(_permit) = self.render_slot.try_acquire() else {
      return Ok(Answer::Text(
        "Botge is rendering another emote. Try again shortly.".into(),
      ));
    };
    let catalog = self.emotes.catalog(guild).await?;
    // An exact catalog match can itself contain spaces.
    if tokens.len() > 1
      && catalog
        .iter()
        .any(|emote| emote.name.eq_ignore_ascii_case(input.trim()))
    {
      tokens = vec![input.trim()];
    }

    let scale = scale.unwrap_or(2);
    let mut layers = Vec::with_capacity(tokens.len());
    for batch in tokens.chunks(4) {
      let catalog = &catalog;
      let found = futures_util::future::join_all(batch.iter().map(|&name| async move {
        let layer = self.resolve_layer(catalog, name, scale).await?;
        Ok::<_, anyhow::Error>((name, layer))
      }))
      .await;
      for result in found {
        let (name, layer) = result?;
        let Some(layer) = layer else {
          return Ok(Answer::Text(format!(
            "No available emote matches `{}`.",
            name.replace('`', "").chars().take(100).collect::<String>()
          )));
        };
        layers.push(layer);
      }
    }

    let border = self.border(user).await?;
    // A single unmodified image can retain its original bytes and timing.
    if let [layer] = layers.as_slice()
      && border.is_none()
    {
      return Ok(Answer::Image(
        rendering::original(self.emotes.http(), layer, self.cache.as_ref()).await?,
      ));
    }
    let image = rendering::compose(
      self.emotes.http(),
      &layers,
      self.cache.as_ref(),
      RenderOptions {
        size_pixels: None,
        stretch,
        border,
      },
    )
    .await?;
    Ok(Answer::Image(image))
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

/// Applies the reply deadline and converts failures to user-facing messages.
async fn render_reply(answer: impl Future<Output = Result<Answer>>) -> Answer {
  match tokio::time::timeout(Duration::from_secs(40), answer).await {
    Ok(Ok(answer)) => answer,
    Ok(Err(error)) => {
      tracing::warn!(%error, "emote request failed");
      if error.is::<tokio::time::error::Elapsed>() {
        Answer::Text("The emote request timed out. Try again.".into())
      } else {
        Answer::Text("Could not load or render those emotes.".into())
      }
    }
    Err(_) => Answer::Text("The emote request timed out. Try again.".into()),
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

/// Completes the final token and ranks exact, prefix, and substring matches in that order.
fn suggestions(emotes: &[Emote], value: &str) -> Vec<String> {
  let query = value.rsplit(char::is_whitespace).next().unwrap_or_default();
  let prefix = value.strip_suffix(query).unwrap_or_default();
  let prefix_length = prefix.chars().count();
  if prefix_length >= 100 {
    return Vec::new();
  }
  let query = query.to_ascii_lowercase();
  let mut seen = HashSet::new();
  let mut matches = Vec::new();
  for emote in emotes {
    if emote.name.is_empty() || (!prefix.is_empty() && emote.name.contains(char::is_whitespace)) {
      continue;
    }
    let name = emote.name.to_ascii_lowercase();
    let Some(offset) = name.find(&query) else {
      continue;
    };
    if prefix_length + emote.name.chars().count() > 100 {
      continue;
    }
    let rank = if name == query {
      0
    } else if offset == 0 {
      1
    } else {
      2
    };
    if seen.insert(name) {
      matches.push((rank, emote.name.as_str()));
    }
  }
  matches.sort_by_key(|(rank, _)| *rank);
  matches
    .into_iter()
    .take(25)
    .map(|(_, name)| format!("{prefix}{name}"))
    .collect()
}

/// Finds the shortest substring that resolves back to each requested emote.
fn shortcuts(emotes: &[Emote], input: &str) -> String {
  let input = input.trim();
  let names = if emotes
    .iter()
    .any(|emote| emote.name.eq_ignore_ascii_case(input))
  {
    vec![input]
  } else {
    input.split_whitespace().take(12).collect()
  };
  // Normalize once: exact names take priority, otherwise every match must name the target.
  let catalog: HashSet<_> = emotes
    .iter()
    .map(|emote| emote.name.to_ascii_lowercase())
    .collect();
  let mut length = 0;
  let lines = names
    .into_iter()
    .filter_map(|name| {
      let emote = find_emote(emotes, name)?;
      let target = emote.name.to_ascii_lowercase();
      let offsets: Vec<_> = emote
        .name
        .char_indices()
        .map(|(index, _)| index)
        .chain(std::iter::once(emote.name.len()))
        .collect();
      let shortest = (1..offsets.len())
        .find_map(|length| {
          offsets.windows(length + 1).find_map(|window| {
            let candidate = emote.name.get(*window.first()?..*window.last()?)?;
            let normalized = candidate.trim().to_ascii_lowercase();
            let unique = if normalized.is_empty() {
              false
            } else if catalog.contains(&normalized) {
              normalized == target
            } else {
              catalog
                .iter()
                .all(|name| name == &target || !name.contains(&normalized))
            };
            unique.then_some(candidate)
          })
        })
        .unwrap_or(&emote.name);
      Some(format!(
        "`{}` → `{}`",
        emote.name.replace('`', ""),
        shortest.replace('`', "")
      ))
    })
    .take_while(|line| {
      length += line.encode_utf16().count() + 1;
      length <= 2000
    })
    .collect::<Vec<_>>();
  if lines.is_empty() {
    "No unique emote names matched.".into()
  } else {
    lines.join("\n")
  }
}

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
