//! Completes provider scales and ranks catalog names within Discord choice limits.

use std::{collections::HashSet, num::NonZeroU64, time::Duration};

use anyhow::Result;
use botge_chemistry::{AtlasIndex, Condition, can_react, can_react_any, substrate_index};
use botge_domain::emotes::find_emote;
use serenity::{
  all::CommandInteraction,
  builder::{CreateAutocompleteResponse, CreateInteractionResponse},
  http::Http,
};

use super::{Commands, string};

/// Canonical Discord choices for `/react-emote`'s `condition` option in priority order.
const CONDITION_CHOICES: [(Condition, &str); 5] = [
  (Condition::Auto, "auto (first compatible)"),
  (Condition::Heat, "heat (Diels-Alder)"),
  (Condition::Acid, "acid (esterification / imine)"),
  (Condition::Base, "base (amide / SN2 / aldol / Michael)"),
  (Condition::Palladium, "palladium (Suzuki-Miyaura)"),
];

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
          self.application.catalog_for_autocomplete(guild),
        )
        .await
        {
          for value in suggestions(&emotes, focused.value) {
            response = response.add_string_choice(value.clone(), value);
          }
        }
      }
      ("react-emote", field @ ("reactant_a" | "reactant_b" | "condition")) => {
        response = self
          .complete_chemistry(response, &command, field, focused.value)
          .await;
      }
      _ => {}
    }
    command
      .create_response(http, CreateInteractionResponse::Autocomplete(response))
      .await?;
    Ok(())
  }

  /// Appends `/react-emote` reactant or condition choices using already selected options.
  async fn complete_chemistry(
    &self,
    mut response: CreateAutocompleteResponse,
    command: &CommandInteraction,
    field: &str,
    focused_value: &str,
  ) -> CreateAutocompleteResponse {
    let options = &command.data.options;
    let raw_a = string(options, "reactant_a");
    let raw_b = string(options, "reactant_b");
    if field == "condition" && raw_a.is_none() && raw_b.is_none() {
      for (label, value) in condition_suggestions(None, focused_value, None, None) {
        response = response.add_string_choice(label, value);
      }
      return response;
    }
    let guild = command
      .guild_id
      .and_then(|guild| NonZeroU64::new(guild.get()));
    let Ok(Ok(emotes)) = tokio::time::timeout(
      Duration::from_secs(2),
      self.application.catalog_for_autocomplete(guild),
    )
    .await
    else {
      return response;
    };
    if field == "condition" {
      let sub_a = raw_a
        .and_then(|query| find_emote(&emotes, query))
        .map(|emote| substrate_index(&emote.id));
      let sub_b = raw_b
        .and_then(|query| find_emote(&emotes, query))
        .map(|emote| substrate_index(&emote.id));
      for (label, value) in condition_suggestions(Some(&emotes), focused_value, sub_a, sub_b) {
        response = response.add_string_choice(label, value);
      }
      return response;
    }
    let partner_raw = if field == "reactant_a" { raw_b } else { raw_a };
    let condition = string(options, "condition")
      .and_then(Condition::parse_option)
      .unwrap_or(Condition::Auto);
    let partner = partner_raw
      .and_then(|query| find_emote(&emotes, query))
      .map(|emote| substrate_index(&emote.id));
    for (label, value) in chemistry_suggestions(&emotes, focused_value, partner, condition) {
      response = response.add_string_choice(label, value);
    }
    response
  }
}

/// Completes the final token and ranks exact, prefix, and substring matches in that order.
pub(super) fn suggestions(emotes: &botge_app::Catalog, value: &str) -> Vec<String> {
  let emotes = emotes.iter();
  let query = value.rsplit(char::is_whitespace).next().unwrap_or_default();
  let prefix = value.strip_suffix(query).unwrap_or_default();
  let prefix_length = prefix.chars().count();
  if prefix_length >= 100 {
    return Vec::new();
  }
  let query = query.to_ascii_lowercase();
  let mut seen = HashSet::with_capacity(emotes.len());
  let mut matches = Vec::with_capacity(emotes.len());
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

/// Completes one emote name for `/react-emote`, filtering to compatible partners when set.
pub(super) fn chemistry_suggestions(
  emotes: &botge_app::Catalog,
  value: &str,
  partner: Option<AtlasIndex>,
  condition: Condition,
) -> Vec<(String, String)> {
  let query = value.trim().to_ascii_lowercase();
  let mut seen = HashSet::with_capacity(emotes.len());
  let mut matches = Vec::with_capacity(emotes.len());
  for emote in emotes {
    if emote.name.is_empty() || emote.name.chars().count() > 100 {
      continue;
    }
    let name = emote.name.to_ascii_lowercase();
    let Some(offset) = name.find(&query) else {
      continue;
    };
    let idx = substrate_index(&emote.id);
    if let Some(partner_idx) = partner {
      if !can_react(partner_idx, idx, condition) {
        continue;
      }
    } else if condition != Condition::Auto && !can_react_any(idx, condition) {
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
      let info = idx.info();
      let full_label = format!("{} — {} ({})", emote.name, info.name, info.group);
      let label: String = full_label.chars().take(100).collect();
      matches.push((rank, label, emote.name.clone()));
    }
  }
  matches.sort_by_key(|(rank, _, _)| *rank);
  matches
    .into_iter()
    .take(25)
    .map(|(_, label, name)| (label, name))
    .collect()
}

/// Completes `/react-emote`'s `condition` option based on already selected reactants.
pub(super) fn condition_suggestions(
  emotes: Option<&botge_app::Catalog>,
  value: &str,
  reactant_a: Option<AtlasIndex>,
  reactant_b: Option<AtlasIndex>,
) -> Vec<(&'static str, &'static str)> {
  let query = value.trim().to_ascii_lowercase();
  CONDITION_CHOICES
    .into_iter()
    .filter(|(condition, label)| {
      if !label.to_ascii_lowercase().contains(&query) {
        return false;
      }
      match (reactant_a, reactant_b) {
        (Some(a), Some(b)) => can_react(a, b, *condition),
        (Some(reactant), None) | (None, Some(reactant)) => emotes.map_or_else(
          || can_react_any(reactant, *condition),
          |catalog| {
            catalog
              .iter()
              .any(|emote| can_react(reactant, substrate_index(&emote.id), *condition))
          },
        ),
        (None, None) => true,
      }
    })
    .map(|(condition, label)| (label, condition.as_str()))
    .collect()
}

#[cfg(test)]
mod tests;
