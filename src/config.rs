// cspell:words jsonc

//! Loads operator configuration. Emote providers are disabled until enabled explicitly.

use std::{fs, io::ErrorKind, path::Path};

use anyhow::{Context as _, Result};
use serde::Deserialize;

/// The operator's JSON configuration, with defaults for omitted sections.
#[derive(Default, Deserialize)]
#[serde(default)]
pub(crate) struct Config {
  pub(crate) general: Providers,
}

/// Operator opt-ins that apply even when a guild has saved provider selections.
#[derive(Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub(crate) struct Providers {
  #[serde(rename = "use7TVGlobalEmotes")]
  pub(crate) seven_global: bool,
  #[serde(rename = "use7TVPersonalEmotes")]
  pub(crate) seven_personal: bool,
  #[serde(rename = "use7TVAddedEmotes")]
  pub(crate) seven_added: bool,
  #[serde(rename = "useBTTVEmotes")]
  pub(crate) bttv: bool,
  #[serde(rename = "useFFZEmotes")]
  pub(crate) ffz: bool,
  #[serde(rename = "useTwitchEmotes")]
  pub(crate) twitch: bool,
}

impl Providers {
  /// The event stream tracks set changes. Individual additions are fetched by ID.
  pub(crate) fn watches_seven_tv_sets(self) -> bool {
    self.seven_global || self.seven_personal
  }
}

impl Config {
  /// Accepts comments and trailing commas. A missing file leaves all providers disabled.
  ///
  /// # Errors
  ///
  /// Reports read failures other than a missing file, along with malformed configuration.
  /// Errors include the path to help identify the file used at startup.
  pub(crate) fn load(path: &Path) -> Result<Self> {
    let text = match fs::read_to_string(path) {
      Ok(text) => text,
      Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Self::default()),
      Err(error) => {
        return Err(error).with_context(|| format!("could not read {}", path.display()));
      }
    };
    jsonc_parser::parse_to_serde_value(
      &text,
      &jsonc_parser::ParseOptions {
        allow_loose_object_property_names: false,
        allow_missing_commas: false,
        allow_single_quoted_strings: false,
        allow_hexadecimal_numbers: false,
        allow_unary_plus_numbers: false,
        allow_bare_decimal_point_numbers: false,
        allow_non_finite_numbers: false,
        allow_extended_string_escapes: false,
        ..Default::default()
      },
    )
    .with_context(|| format!("invalid configuration in {}", path.display()))
  }
}

#[cfg(test)]
mod tests;
