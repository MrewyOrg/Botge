//! Checks the Theorem 4.3 identities that Lean proves against the interval simulator, across all
//! 414 admissible configurations.
//!
//! Lean proves these identities for the exact Born law of the circuit it defines. Every simulator
//! enclosure must contain the value an identity predicts, so agreement in every configuration ties
//! the simulated function to Lean's definitions far beyond the 2-by-2 case.

#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use std::sync::LazyLock;

use botge_quantum_certificate::{Config, Interval, State, admissible, coupling_scale};

/// Largest enclosure width any checked moment may have; far below every identity's scale.
const MAX_WIDTH: f64 = 1e-9;

/// Cached simulated Born laws across all 414 admissible configurations.
static LAWS: LazyLock<Vec<Law>> =
  LazyLock::new(|| admissible().into_iter().map(Law::new).collect());

/// The simulated Born law of one configuration.
struct Law {
  config: Config,
  probabilities: Vec<Interval>,
}

impl Law {
  fn new(config: Config) -> Self {
    Self {
      config,
      probabilities: State::closed_form(config).probabilities(),
    }
  }

  /// Enclosure of `P_L(x_b, x_o)`; unbounded if the index is out of range, so checks fail.
  fn at(&self, base: usize, overlay: usize) -> Interval {
    self
      .probabilities
      .get(self.config.index(base, overlay))
      .copied()
      .unwrap_or_else(Interval::entire)
  }

  /// Enclosure of `E[∏_{j ∈ base_mask} Z_{b,j} ∏_{ℓ ∈ overlay_mask} Z_{o,ℓ}]`, with `Z = +1` on bit 0.
  fn moment(&self, base_mask: usize, overlay_mask: usize) -> Interval {
    (0..self.config.base_size())
      .flat_map(|base| (0..self.config.overlay_size()).map(move |overlay| (base, overlay)))
      .map(|(base, overlay)| {
        let flips = (base & base_mask).count_ones() + (overlay & overlay_mask).count_ones();
        let probability = self.at(base, overlay);
        if flips % 2 == 0 {
          probability
        } else {
          -probability
        }
      })
      .sum()
  }

  /// Enclosure of the cross-register angle `|θ_{bo,j,ℓ}| = u_L 2^{j+ℓ} / N_max`.
  fn cross_angle(&self, base_bit: u32, overlay_bit: u32) -> Interval {
    coupling_scale(self.config.depth())
      * Interval::point(f64::from(1_u32 << (base_bit + overlay_bit)))
      / Interval::point(f64::from(
        1_u32 << self.config.base().max(self.config.overlay()),
      ))
  }
}

/// `sin(N x) / (N sin x)`, the Dirichlet ratio in `eq:intra-corr`.
fn dirichlet(size: u32, x: Interval) -> Interval {
  let size = Interval::point(f64::from(1_u32 << size));
  let (numerator, _) = (size * x).sin_cos();
  let (denominator, _) = x.sin_cos();
  numerator / (size * denominator)
}

/// The `eq:intra-corr` prediction for bits `low < high` of a register whose partner has
/// `partner_bits` qubits.
fn intra_prediction(config: Config, low: u32, high: u32, partner_bits: u32) -> Interval {
  let scale = coupling_scale(config.depth())
    / Interval::point(f64::from(1_u32 << config.base().max(config.overlay())));
  let (low, high) = (
    Interval::point(f64::from(1_u32 << low)),
    Interval::point(f64::from(1_u32 << high)),
  );
  let (minus, plus) = (scale * (high - low), scale * (high + low));
  (dirichlet(partner_bits, minus) - dirichlet(partner_bits, plus)) / Interval::point(4.0)
}

/// Asserts that a simulated moment encloses the predicted value tightly.
fn assert_matches(simulated: Interval, predicted: Interval, what: &str) {
  assert!(
    simulated.overlaps(predicted),
    "{what}: simulated {simulated:?}, predicted {predicted:?}"
  );
  assert!(
    simulated.width() < MAX_WIDTH,
    "{what}: simulated {simulated:?} is too wide"
  );
  assert!(
    predicted.width() < MAX_WIDTH,
    "{what}: predicted {predicted:?} is too wide"
  );
}

#[test]
fn born_law_is_complement_invariant_with_uniform_bits() {
  for law in &*LAWS {
    let config = law.config;
    let (base_last, overlay_last) = (config.base_size() - 1, config.overlay_size() - 1);
    for base in 0..config.base_size() {
      for overlay in 0..config.overlay_size() {
        assert!(
          law
            .at(base, overlay)
            .overlaps(law.at(base_last - base, overlay_last - overlay)),
          "{config:?}: P({base}, {overlay}) is not complement invariant"
        );
      }
    }
    for bit in 0..config.base() {
      assert_matches(law.moment(1 << bit, 0), Interval::point(0.0), "E[Z_b]");
    }
    for bit in 0..config.overlay() {
      assert_matches(law.moment(0, 1 << bit), Interval::point(0.0), "E[Z_o]");
    }
  }
}

// At the readout angle φ = -π/4 the prefactor -sin(2φ) / 2 of eq:bitwise-corr is 1/2.
#[test]
fn cross_register_correlations_match_eq_bitwise_corr() {
  for law in &*LAWS {
    let config = law.config;
    for j in 0..config.base() {
      for l in 0..config.overlay() {
        let cos =
          |base_bit: u32, overlay_bit: u32| law.cross_angle(base_bit, overlay_bit).sin_cos().1;
        let base_product: Interval = (0..config.base())
          .filter(|&other| other != j)
          .fold(Interval::point(1.0), |product, other| {
            product * cos(other, l)
          });
        let overlay_product: Interval = (0..config.overlay())
          .filter(|&other| other != l)
          .fold(Interval::point(1.0), |product, other| {
            product * cos(j, other)
          });
        let (sin, _) = law.cross_angle(j, l).sin_cos();
        assert_matches(
          law.moment(1 << j, 1 << l),
          sin * (base_product + overlay_product) / Interval::point(2.0),
          &format!("{config:?} Corr(Z_b{j}, Z_o{l})"),
        );
      }
    }
  }
}

#[test]
fn intra_register_correlations_match_eq_intra_corr_in_both_registers() {
  for law in &*LAWS {
    let config = law.config;
    for high in 0..config.base() {
      for low in 0..high {
        assert_matches(
          law.moment((1 << low) | (1 << high), 0),
          intra_prediction(config, low, high, config.overlay()),
          &format!("{config:?} Corr(Z_b{low}, Z_b{high})"),
        );
      }
    }
    for high in 0..config.overlay() {
      for low in 0..high {
        assert_matches(
          law.moment(0, (1 << low) | (1 << high)),
          intra_prediction(config, low, high, config.base()),
          &format!("{config:?} Corr(Z_o{low}, Z_o{high})"),
        );
      }
    }
  }
}
