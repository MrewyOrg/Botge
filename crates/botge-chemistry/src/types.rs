//! Wire types, bounds validation, PNG verification, and client-safe errors for `/react-emote`.

use core::{error::Error, fmt};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

use crate::AtlasIndex;

/// Maximum PNG payload size accepted from the chemistry sidecar (128 KiB).
pub(crate) const MAX_DIAGRAM_BYTES: usize = 131_072;

const PNG_MAGIC: [u8; 8] = *b"\x89PNG\r\n\x1a\n";

/// Whether `/react-emote` requests a dark-mode 2D skeletal structure PNG from the sidecar.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Diagram {
  /// Request and validate the 2D skeletal PNG diagram.
  #[default]
  Include,
  /// Omit the 2D skeletal PNG diagram.
  Omit,
}

impl Diagram {
  /// Returns `true` when a 2D skeletal diagram should be requested.
  #[must_use]
  pub const fn is_included(self) -> bool {
    matches!(self, Self::Include)
  }
}

/// Supported reaction conditions for `/react-emote`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Condition {
  /// Automatically select the first compatible reaction by deterministic priority.
  #[default]
  Auto,
  /// Thermal activation (Diels-Alder).
  Heat,
  /// Acid catalysis (Fischer esterification, imine condensation).
  Acid,
  /// Basic activation (amide coupling, Williamson SN2, aldol, Michael addition).
  Base,
  /// Palladium cross-coupling (Suzuki-Miyaura).
  Palladium,
}

impl Condition {
  /// Stable lowercase condition string matching Discord choices and sidecar JSON.
  #[must_use]
  pub const fn as_str(self) -> &'static str {
    match self {
      Self::Auto => "auto",
      Self::Heat => "heat",
      Self::Acid => "acid",
      Self::Base => "base",
      Self::Palladium => "palladium",
    }
  }

  /// Parses a Discord command option string into a [`Condition`].
  #[must_use]
  pub fn parse_option(raw: &str) -> Option<Self> {
    match raw.trim().to_ascii_lowercase().as_str() {
      "auto" => Some(Self::Auto),
      "heat" => Some(Self::Heat),
      "acid" => Some(Self::Acid),
      "base" => Some(Self::Base),
      "palladium" => Some(Self::Palladium),
      _ => None,
    }
  }
}

impl fmt::Display for Condition {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str(self.as_str())
  }
}

/// Provider image scale for rendered emotes (`1..=4`, default `2`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Size(u16);

impl Size {
  /// Smallest provider scale.
  pub const MIN: u16 = 1;
  /// Largest provider scale.
  pub const MAX: u16 = 4;

  /// Returns the bounded provider scale.
  #[must_use]
  pub const fn get(self) -> u16 {
    self.0
  }
}

impl Default for Size {
  fn default() -> Self {
    Self(2)
  }
}

impl TryFrom<i64> for Size {
  type Error = OutOfRange;

  /// Accepts `1..=4` without clamping.
  fn try_from(value: i64) -> Result<Self, OutOfRange> {
    u16::try_from(value)
      .ok()
      .filter(|size| (Self::MIN..=Self::MAX).contains(size))
      .map(Self)
      .ok_or(OutOfRange {
        option: "size",
        min: Self::MIN,
        max: Self::MAX,
      })
  }
}

/// An integer command option outside its accepted bounds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutOfRange {
  option: &'static str,
  min: u16,
  max: u16,
}

impl fmt::Display for OutOfRange {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let Self { option, min, max } = self;
    write!(f, "Choose {option} from {min} to {max}.")
  }
}

impl Error for OutOfRange {}

/// The chemistry sidecar's optional Bearer secret, redacted in [`fmt::Debug`].
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
  /// Trims whitespace and returns `None` when blank.
  #[must_use]
  pub fn new(value: &str) -> Option<Self> {
    let value = value.trim();
    (!value.is_empty()).then(|| Self(value.to_owned()))
  }

  /// Exposes the secret for the `Authorization` header only.
  pub(crate) fn expose(&self) -> &str {
    &self.0
  }
}

impl fmt::Debug for Secret {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str("Secret([redacted])")
  }
}

/// JSON request payload sent to `POST /v1/react`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ReactRequest {
  pub(crate) reactant_a: AtlasIndex,
  pub(crate) reactant_b: AtlasIndex,
  pub(crate) condition: Condition,
  pub(crate) base_pool_size: u32,
  pub(crate) overlay_pool_size: u32,
  pub(crate) exclude_base_indices: Vec<u32>,
  pub(crate) include_diagram: bool,
}

/// Strictly decoded JSON response from `POST /v1/react`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReactResponse {
  /// The substrates reacted under a compatible template.
  Reacted {
    /// Machine identifier of the reaction template.
    reaction_id: String,
    /// Human-readable reaction name.
    reaction_name: String,
    /// Explicit condition that triggered the reaction.
    condition_used: Condition,
    /// Display name of the first reactant substrate.
    substrate_a_name: String,
    /// Display name of the second reactant substrate.
    substrate_b_name: String,
    /// Canonical isomeric SMILES of the sanitized product.
    product_smiles: String,
    /// Molecular formula of the product.
    product_formula: String,
    /// Rounded average molecular weight in g/mol.
    product_mw: f64,
    /// Standard `InChIKey` of the product.
    inchi_key: String,
    /// Projected base emote index in `[0, M_b)`.
    base_index: u32,
    /// Projected overlay emote index in `[0, M_o)`.
    overlay_index: u32,
    /// Optional base64-encoded dark-mode 2D skeletal PNG (`<= 128 KiB`).
    diagram_png_b64: Option<String>,
  },
  /// No reaction template matched the substrate pair under the requested condition.
  NoReaction {
    /// Display name of the first reactant substrate.
    substrate_a_name: String,
    /// Functional group description of the first substrate.
    substrate_a_group: String,
    /// Display name of the second reactant substrate.
    substrate_b_name: String,
    /// Functional group description of the second substrate.
    substrate_b_group: String,
    /// Explanation of why no reaction occurred.
    reason: String,
    /// Another condition under which the substrates react, if any.
    hint_condition: Option<Condition>,
    /// Reaction name matching `hint_condition`, if any.
    hint_reaction: Option<String>,
  },
}

/// Decodes and validates a base64-encoded PNG diagram within [`MAX_DIAGRAM_BYTES`].
///
/// # Errors
///
/// Returns [`ChemError::Invalid`] if base64 decoding fails, the payload is empty or exceeds
/// [`MAX_DIAGRAM_BYTES`], or the decoded bytes lack the PNG signature.
pub(crate) fn decode_diagram_png(encoded: &str) -> Result<Vec<u8>, ChemError> {
  if encoded.len() > MAX_DIAGRAM_BYTES.div_ceil(3) * 4 + 4 {
    return Err(ChemError::Invalid);
  }
  let bytes = STANDARD
    .decode(encoded)
    .map_err(|_error| ChemError::Invalid)?;
  if bytes.is_empty() || bytes.len() > MAX_DIAGRAM_BYTES || !bytes.starts_with(&PNG_MAGIC) {
    return Err(ChemError::Invalid);
  }
  Ok(bytes)
}

/// Client-safe failure modes for `/react-emote`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChemError {
  /// Too many chemistry requests are already in flight.
  Busy,
  /// Sidecar unreachable, timed out, or failed with 5xx.
  Unavailable,
  /// Sidecar rejected the request (4xx status).
  Refused,
  /// Sidecar answered with malformed, oversized, or out-of-bounds data.
  Invalid,
}

impl ChemError {
  /// Stable Prometheus metric label for this failure.
  #[must_use]
  pub const fn label(self) -> &'static str {
    match self {
      Self::Busy => "busy",
      Self::Unavailable => "unavailable",
      Self::Refused => "refused",
      Self::Invalid => "invalid",
    }
  }
}

impl fmt::Display for ChemError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str(match self {
      Self::Busy => "The chemistry sidecar is busy. Try again shortly.",
      Self::Unavailable => "The chemistry sidecar is unavailable.",
      Self::Refused => "The chemistry sidecar refused the request.",
      Self::Invalid => "The chemistry sidecar sent an invalid response.",
    })
  }
}

impl Error for ChemError {}

#[cfg(test)]
mod tests;
