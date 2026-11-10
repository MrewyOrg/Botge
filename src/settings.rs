//! Validates guild voice preferences and canonical Discord identifiers.

use std::num::NonZeroU64;

use serde::{Deserialize, Serialize};

/// Saved voice selection and status preference for one guild.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct VoiceSettings {
  pub(crate) channel_id: Option<String>,
  pub(crate) status_enabled: bool,
  /// The saved text is retained when the status toggle is off or the channel is cleared.
  pub(crate) status_emoji: Option<String>,
}

impl VoiceSettings {
  /// Resolves the stored channel ID, if present and canonical.
  pub(crate) fn channel(&self) -> Option<NonZeroU64> {
    self.channel_id.as_deref().and_then(discord_id)
  }

  /// Returns the saved text only while status updates are enabled.
  pub(crate) fn status(&self) -> Option<&str> {
    self.status_emoji.as_deref().filter(|_| self.status_enabled)
  }

  /// Accepts a canonical channel ID and up to 128 bytes of non-control status text.
  pub(crate) fn is_valid(&self) -> bool {
    self
      .channel_id
      .as_ref()
      .is_none_or(|_| self.channel().is_some())
      && self.status_emoji.as_deref().is_none_or(|emoji| {
        !emoji.is_empty() && emoji.len() <= 128 && !emoji.chars().any(char::is_control)
      })
  }
}

/// Parses Discord IDs in canonical, nonzero decimal form.
pub(crate) fn discord_id(value: &str) -> Option<NonZeroU64> {
  value
    .parse::<NonZeroU64>()
    .ok()
    .filter(|id| id.to_string() == value)
}

#[cfg(test)]
mod tests;
