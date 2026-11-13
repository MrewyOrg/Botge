//! Finds minimal unambiguous emote substrings while preserving Unicode boundaries.

use std::collections::HashSet;

use crate::emotes::{Emote, find_emote};

/// Finds the shortest substring that resolves back to each requested emote.
pub(super) fn shortcuts(emotes: &[Emote], input: &str) -> String {
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

#[cfg(test)]
mod tests;
