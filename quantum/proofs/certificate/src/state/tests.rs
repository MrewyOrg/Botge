//! Checks the simulator against the gate-level circuit, unitarity and the 2-by-2 Born law.

#![expect(
  clippy::missing_panics_doc,
  clippy::indexing_slicing,
  reason = "Test assertions panic on failure and index fixed-size statevector buffers"
)]

use super::*;

/// Enclosure of the total probability `Σ |ψ_x|²`.
fn norm_squared(state: &State) -> Interval {
  state.probabilities().into_iter().sum()
}

#[test]
fn closed_form_matches_the_gate_by_gate_circuit() {
  for config in [
    Config::new(1, 1, 3),
    Config::new(2, 2, 5),
    Config::new(3, 2, 3),
    Config::new(2, 3, 6),
    Config::new(4, 3, 1),
  ] {
    let (closed, gates) = (State::closed_form(config), State::gate_by_gate(config));
    assert!(
      closed.overlaps(&gates),
      "{config:?}: the enclosures are disjoint"
    );
    assert!(closed.max_width() < 1e-13 && gates.max_width() < 1e-13);
  }
}

#[test]
fn disjoint_enclosures_prove_states_differ() {
  let (shallow, deep) = (
    State::closed_form(Config::new(2, 2, 1)),
    State::closed_form(Config::new(2, 2, 6)),
  );
  assert!(!shallow.overlaps(&deep));
  assert!(!shallow.overlaps(&State::closed_form(Config::new(2, 1, 1))));
}

#[test]
fn both_constructions_stay_normalized() {
  for config in [
    Config::new(1, 1, 1),
    Config::new(5, 4, 3),
    Config::new(9, 7, 6),
    Config::new(10, 6, 1),
  ] {
    let total = norm_squared(&State::closed_form(config));
    assert!(
      total.contains(1.0) && total.width() < 1e-10,
      "{config:?}: {total:?}"
    );
  }
  assert!(norm_squared(&State::gate_by_gate(Config::new(4, 4, 6))).contains(1.0));
}

#[test]
fn readout_layer_is_unitary() {
  let mut state = State::zeros(3);
  state.re[5] = Interval::decimal(0.6);
  state.im[2] = Interval::decimal(0.8);
  state.apply_readout(3);
  assert!(norm_squared(&state).contains(1.0));
}

#[test]
fn two_by_two_born_law_matches_corollary_4_4() {
  for depth in 1..=6 {
    let config = Config::new(1, 1, depth);
    let (correlation, _) = (coupling_scale(depth) / Interval::point(2.0)).sin_cos();
    let probabilities = State::closed_form(config).probabilities();
    for base in 0..2 {
      for overlay in 0..2 {
        let spin = if base == overlay { 1.0 } else { -1.0 };
        let expected =
          (Interval::point(1.0) + Interval::point(spin) * correlation) / Interval::point(4.0);
        let actual = probabilities[config.index(base, overlay)];
        assert!(
          actual.overlaps(expected) && actual.width() < 1e-13,
          "L = {depth}, ({base}, {overlay}): {actual:?} vs {expected:?}"
        );
      }
    }
  }
}
