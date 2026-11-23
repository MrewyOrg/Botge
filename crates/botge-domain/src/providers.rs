//! Operator-controlled provider opt-ins.

use serde::Deserialize;

/// Operator opt-ins that apply even when a guild has saved provider selections.
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Providers {
  #[serde(rename = "use7TVGlobalEmotes")]
  /// Enable global 7TV emotes.
  pub seven_global: bool,
  #[serde(rename = "use7TVPersonalEmotes")]
  /// Enable guild-selected personal 7TV sets.
  pub seven_personal: bool,
  #[serde(rename = "use7TVAddedEmotes")]
  /// Enable individually saved 7TV additions.
  pub seven_added: bool,
}

impl Providers {
  /// The event stream tracks set changes. Individual additions are fetched by ID.
  #[must_use]
  pub const fn watches_seven_tv_sets(self) -> bool {
    self.seven_global || self.seven_personal
  }
}
