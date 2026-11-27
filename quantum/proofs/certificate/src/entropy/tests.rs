//! Checks both entropies against known distributions and a brute-force reduced density matrix.

#![expect(
  clippy::missing_panics_doc,
  clippy::indexing_slicing,
  reason = "Test assertions panic on failure and index fixed-size statevector buffers"
)]

use super::*;
use crate::state::State;

/// `-log₂ Tr ρ_B²`, with `ρ_B[b][b'] = Σ_o ψ(b, o) ψ*(b', o)` built from the full statevector.
///
/// The readout layer acts locally on each register, so it leaves the spectrum of `ρ_B` unchanged.
fn brute_force_collision_entropy(config: Config) -> Interval {
  let state = State::closed_form(config);
  let mut purity = Interval::point(0.0);
  for row in 0..config.base_size() {
    for column in 0..config.base_size() {
      let (mut re, mut im) = (Interval::point(0.0), Interval::point(0.0));
      for overlay in 0..config.overlay_size() {
        let (a, b) = (config.index(row, overlay), config.index(column, overlay));
        re = re + state.re[a] * state.re[b] + state.im[a] * state.im[b];
        im = im + state.im[a] * state.re[b] - state.re[a] * state.im[b];
      }
      purity = purity + re.square() + im.square();
    }
  }
  -purity.log2()
}

#[test]
fn entropy_of_known_distributions() {
  let point = Interval::point;
  assert!(entropy(&[point(1.0), point(0.0), point(0.0)]).contains(0.0));
  assert!(entropy(&[point(0.25); 4]).contains(2.0));
  assert!(entropy(&[point(0.5), point(0.0), point(0.5)]).contains(1.0));
}

#[test]
fn collision_entropy_matches_the_reduced_density_matrix() {
  for config in [
    Config::new(1, 1, 3),
    Config::new(2, 3, 4),
    Config::new(3, 2, 2),
    Config::new(3, 3, 6),
    Config::new(4, 2, 5),
  ] {
    let (formula, brute) = (
      collision_entropy(config),
      brute_force_collision_entropy(config),
    );
    assert!(
      formula.overlaps(brute),
      "{config:?}: {formula:?} vs {brute:?}"
    );
    assert!(formula.width() < 1e-12);
  }
}

#[test]
fn two_by_two_collision_entropy_follows_the_corollary_4_4_spectrum() {
  for depth in 1..=6 {
    let (_, cos) = (coupling_scale(depth) / Interval::point(2.0)).sin_cos();
    let expected = -((Interval::point(1.0) + cos.square()) / Interval::point(2.0)).log2();
    let actual = collision_entropy(Config::new(1, 1, depth));
    assert!(actual.overlaps(expected), "L = {depth}");
  }
}
