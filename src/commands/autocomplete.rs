// cspell:words rsplit

//! Completes provider scales and ranks catalog names within Discord choice limits.

use std::{collections::HashSet, num::NonZeroU64, time::Duration};

use anyhow::Result;
use serenity::{
  all::CommandInteraction,
  builder::{CreateAutocompleteResponse, CreateInteractionResponse},
  http::Http,
};

use super::Commands;
use crate::emotes::Emote;

impl Commands {
  /// Returns size or emote choices. If the lookup exceeds its deadline, sends an empty list.
  ///
  /// # Errors
  ///
  /// Returns an error only when the autocomplete response cannot be sent. Catalog errors and
  /// lookup deadlines produce an empty choice list.
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

#[cfg(test)]
mod tests;
