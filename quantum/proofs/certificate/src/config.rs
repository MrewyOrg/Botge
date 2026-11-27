//! Admissible register configurations `(n_b, n_o, L)` and the depth-dependent coupling scale.

use crate::interval::Interval;

/// Widest base register: a 1024-emote pool needs ten qubits.
const MAX_BASE_BITS: u32 = 10;

/// Widest overlay register: a 128-emote pool needs seven qubits.
const MAX_OVERLAY_BITS: u32 = 7;

/// Circuit width limit `n_b + n_o ≤ 16` from Proposition 2.1.
const MAX_QUBITS: u32 = 16;

/// Deepest circuit the specification certifies.
const MAX_DEPTH: u32 = 6;

/// An enclosure of the coupling scale `u_L = φ⁻¹ √L` for depth `L`, where `φ⁻¹ = (√5 - 1) / 2`.
#[must_use]
pub fn coupling_scale(depth: u32) -> Interval {
  let golden_inverse = (Interval::point(5.0).sqrt() - Interval::point(1.0)) / Interval::point(2.0);
  golden_inverse * Interval::point(f64::from(depth)).sqrt()
}

/// One register configuration `(n_b, n_o, L)` of the quantum emote circuit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config {
  base: u32,
  overlay: u32,
  depth: u32,
}

impl Config {
  /// Configuration with base width `n_b`, overlay width `n_o` and depth `L`.
  ///
  /// # Panics
  ///
  /// Panics unless `1 <= base <= 10`, `1 <= overlay <= 7`, `base + overlay <= 16` and
  /// `1 <= depth <= 6`.
  #[must_use]
  pub const fn new(base: u32, overlay: u32, depth: u32) -> Self {
    assert!(
      base >= 1 && base <= MAX_BASE_BITS,
      "base width must be in 1..=10"
    );
    assert!(
      overlay >= 1 && overlay <= MAX_OVERLAY_BITS,
      "overlay width must be in 1..=7"
    );
    assert!(
      base + overlay <= MAX_QUBITS,
      "total qubit width must not exceed 16"
    );
    assert!(depth >= 1 && depth <= MAX_DEPTH, "depth must be in 1..=6");
    Self {
      base,
      overlay,
      depth,
    }
  }

  /// Base register width `n_b`.
  #[must_use]
  pub const fn base(self) -> u32 {
    self.base
  }

  /// Overlay register width `n_o`.
  #[must_use]
  pub const fn overlay(self) -> u32 {
    self.overlay
  }

  /// Circuit depth `L`.
  #[must_use]
  pub const fn depth(self) -> u32 {
    self.depth
  }

  /// Number of base basis states `N_b = 2^{n_b}`.
  #[must_use]
  pub const fn base_size(self) -> usize {
    1 << self.base
  }

  /// Number of overlay basis states `N_o = 2^{n_o}`.
  #[must_use]
  pub const fn overlay_size(self) -> usize {
    1 << self.overlay
  }

  /// Total circuit width `n_b + n_o`.
  #[must_use]
  pub const fn qubits(self) -> u32 {
    self.base + self.overlay
  }

  /// Basis index of `(x_b, x_o)`; the base register holds the high bits.
  #[must_use]
  pub const fn index(self, base: usize, overlay: usize) -> usize {
    (base << self.overlay) | overlay
  }

  /// Smallest pool `M^min(n) = max(2, 2^{n-1} + 1)` whose register needs `bits` qubits.
  ///
  /// # Panics
  ///
  /// Panics unless `1 <= bits <= 10`.
  #[must_use]
  pub const fn min_domain(bits: u32) -> usize {
    assert!(
      bits >= 1 && bits <= MAX_BASE_BITS,
      "register width must be in 1..=10"
    );
    if bits == 1 { 2 } else { (1 << (bits - 1)) + 1 }
  }
}

/// All 414 admissible configurations, ordered by base width, overlay width and depth.
///
/// They are `n_b ∈ 1..=10`, `n_o ∈ 1..=7` with `n_b + n_o ≤ 16`, and `L ∈ 1..=6`.
#[must_use]
pub fn admissible() -> Vec<Config> {
  let mut configs = Vec::with_capacity(414);
  for base in 1..=MAX_BASE_BITS {
    for overlay in (1..=MAX_OVERLAY_BITS).filter(|overlay| base + overlay <= MAX_QUBITS) {
      configs.extend((1..=MAX_DEPTH).map(|depth| Config::new(base, overlay, depth)));
    }
  }
  configs
}

#[cfg(test)]
mod tests;
