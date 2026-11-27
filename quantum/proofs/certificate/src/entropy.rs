//! Shannon entropy of measured distributions and the collision entropy of the base register.

use crate::{
  config::{Config, coupling_scale},
  interval::Interval,
};

/// An enclosure of the Shannon entropy `H(p) = -Σ p log₂ p` in bits, with `0 log 0 = 0`.
#[must_use]
pub fn entropy(probabilities: &[Interval]) -> Interval {
  probabilities.iter().map(|p| p.entropy_term()).sum()
}

/// An enclosure of `S₂(ρ_B) = -log₂ Tr ρ_B²` from the Toeplitz purity formula (`eq:purity`).
#[expect(
  clippy::cast_precision_loss,
  reason = "Register sizes and deltas are at most 65_536, which f64 represents exactly"
)]
#[must_use]
pub fn collision_entropy(config: Config) -> Interval {
  let (base_size, overlay_size) = (config.base_size(), config.overlay_size());
  let (max_size, min_size) = (
    Interval::point(base_size.max(overlay_size) as f64),
    base_size.min(overlay_size),
  );
  let scale = coupling_scale(config.depth());
  let off_diagonal: Interval = (1..min_size)
    .map(|delta| {
      let delta = Interval::point(delta as f64);
      let (numerator, _) = (scale * delta).sin_cos();
      let (denominator, _) = (scale * delta / max_size).sin_cos();
      let g = numerator / (max_size * denominator);
      (Interval::point(min_size as f64) - delta) * g.square()
    })
    .sum();
  let min_size = Interval::point(min_size as f64);
  let purity =
    Interval::point(1.0) / min_size + Interval::point(2.0) / min_size.square() * off_diagonal;
  -purity.log2()
}

#[cfg(test)]
mod tests;
