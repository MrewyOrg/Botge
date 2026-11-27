//! Command bounds, the sidecar wire format and client-safe failures for quantum emote requests.

use core::{error::Error, fmt};

use serde::{Deserialize, Serialize};

/// Circuit depth `L` (Definition 3.1): the coupling `u_L = φ⁻¹√L` stays below `π / 2` up to six.
///
/// The sidecar defaults to three steps, so the command does too.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Steps(u8);

impl Steps {
  /// Fewest coupling steps the circuit accepts.
  pub const MIN: u8 = 1;
  /// Most coupling steps, the largest `L` with `u_L < π / 2`.
  pub const MAX: u8 = 6;

  /// The number of steps, between [`Self::MIN`] and [`Self::MAX`].
  #[must_use]
  pub const fn get(self) -> u8 {
    self.0
  }
}

impl Default for Steps {
  fn default() -> Self {
    Self(3)
  }
}

impl TryFrom<i64> for Steps {
  type Error = OutOfRange;

  /// Accepts `1..=6` without clamping.
  fn try_from(value: i64) -> Result<Self, OutOfRange> {
    u8::try_from(value)
      .ok()
      .filter(|steps| (Self::MIN..=Self::MAX).contains(steps))
      .map(Self)
      .ok_or_else(|| OutOfRange {
        option: "steps",
        min: Self::MIN.into(),
        max: Self::MAX.into(),
      })
  }
}

/// Provider image scale for the rendered emotes, the same `1..=4` range as `/emote-compose`.
///
/// Defaults to 2, as the command option states.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Size(u16);

impl Size {
  /// Smallest provider scale.
  pub const MIN: u16 = 1;
  /// Largest provider scale.
  pub const MAX: u16 = 4;

  /// The provider scale, between [`Self::MIN`] and [`Self::MAX`].
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

/// A command option outside its accepted range; the value is rejected rather than clamped.
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

/// The sidecar's Bearer secret, never printed by [`fmt::Debug`].
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
  /// Wraps a configured secret without surrounding whitespace, as the sidecar reads it.
  ///
  /// A blank value means the sidecar runs without authentication.
  #[must_use]
  pub fn new(value: &str) -> Option<Self> {
    let value = value.trim();
    (!value.is_empty()).then(|| Self(value.to_owned()))
  }

  /// The secret text, for the `Authorization` header only.
  pub(crate) fn expose(&self) -> &str {
    &self.0
  }
}

impl fmt::Debug for Secret {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str("Secret([redacted])")
  }
}

/// JSON body of `POST /v1/entangle`: both pool sizes `M_b`, `M_o` and the circuit depth.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct EntangleRequest {
  pub(crate) base_pool_size: u32,
  pub(crate) overlay_pool_size: u32,
  pub(crate) steps: Steps,
}

/// The only `mode` the sidecar reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
  /// One accepted shot of the Ising-Rx circuit.
  Entangle,
}

/// One accepted measurement: the circuit width and the in-pool base and overlay indices.
///
/// Decoding is strict: unknown fields, another `mode` or a missing field is rejected.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sample {
  #[serde(rename = "mode")]
  _mode: Mode,
  pub(crate) qubits: u32,
  pub(crate) base_index: u32,
  pub(crate) overlay_index: u32,
}

/// Why no emote was drawn. Every message is safe to show users and states that nothing was drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuantumError {
  /// Too many quantum requests are already waiting on the sidecar.
  Busy,
  /// The sidecar could not be reached, timed out or failed.
  Unavailable,
  /// The sidecar rejected the request, for example its credentials or bounds.
  Refused,
  /// Rejection sampling used its whole shot budget without an in-pool result (HTTP 503).
  Exhausted,
  /// The sidecar answered with a body that does not match the request.
  Invalid,
}

impl QuantumError {
  /// Stable metric label for this failure.
  #[must_use]
  pub const fn label(self) -> &'static str {
    match self {
      Self::Busy => "busy",
      Self::Unavailable => "unavailable",
      Self::Refused => "refused",
      Self::Exhausted => "exhausted",
      Self::Invalid => "invalid",
    }
  }
}

impl fmt::Display for QuantumError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str(match self {
      Self::Busy => "The quantum sidecar is busy. No emote was drawn; try again shortly.",
      Self::Unavailable => "The quantum sidecar is unavailable. No emote was drawn.",
      Self::Refused => "The quantum sidecar refused the request. No emote was drawn.",
      Self::Exhausted => {
        "The quantum circuit never landed inside both emote pools within its shot budget. No emote \
         was drawn."
      }
      Self::Invalid => "The quantum sidecar sent an invalid result. No emote was drawn.",
    })
  }
}

impl Error for QuantumError {}

#[cfg(test)]
mod tests;
