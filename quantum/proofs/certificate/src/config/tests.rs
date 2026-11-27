//! Ties the admissible domain to the production register budget of `botge-quantum`.

#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use std::collections::BTreeSet;

use botge_quantum::Budget;

use super::*;

/// Largest pool sizes worth probing: every larger pool is capped to these.
const PROBED_BASE: usize = 1100;
const PROBED_OVERLAY: usize = 200;

#[test]
fn admissible_widths_are_exactly_those_the_budget_produces() {
  let mut produced = BTreeSet::new();
  for base in 2..=PROBED_BASE {
    for overlay in 2..=PROBED_OVERLAY {
      let budget = Budget::new(base, overlay);
      assert!(budget.is_ok(), "({base}, {overlay}) has no budget");
      if let Ok(budget) = budget {
        produced.insert((budget.base_bits(), budget.overlay_bits()));
      }
    }
  }
  let configs = admissible();
  let widths: BTreeSet<(u32, u32)> = configs.iter().map(|c| (c.base(), c.overlay())).collect();
  assert_eq!(widths, produced);
  for (base, overlay) in widths {
    let depths: Vec<u32> = configs
      .iter()
      .filter(|c| (c.base(), c.overlay()) == (base, overlay))
      .map(|c| c.depth())
      .collect();
    assert_eq!(depths, (1..=MAX_DEPTH).collect::<Vec<_>>());
  }
}

#[test]
fn min_domain_is_the_smallest_pool_the_budget_sizes_to_each_width() {
  for bits in 1..=MAX_BASE_BITS {
    let smallest = Config::min_domain(bits);
    assert_eq!(Budget::new(smallest, 2).map(Budget::base_bits), Ok(bits));
    if bits > 1 {
      assert_eq!(
        Budget::new(smallest - 1, 2).map(Budget::base_bits),
        Ok(bits - 1)
      );
    }
  }
  for bits in 1..=MAX_OVERLAY_BITS {
    let smallest = Config::min_domain(bits);
    assert_eq!(Budget::new(2, smallest).map(Budget::overlay_bits), Ok(bits));
    if bits > 1 {
      assert_eq!(
        Budget::new(2, smallest - 1).map(Budget::overlay_bits),
        Ok(bits - 1)
      );
    }
  }
}

#[test]
#[should_panic(expected = "base width must be in 1..=10")]
fn config_rejects_zero_base_width() {
  assert_eq!(Config::new(0, 1, 1).base(), 0);
}

#[test]
#[should_panic(expected = "base width must be in 1..=10")]
fn config_rejects_oversized_base_width() {
  assert_eq!(Config::new(11, 1, 1).base(), 11);
}

#[test]
#[should_panic(expected = "overlay width must be in 1..=7")]
fn config_rejects_zero_overlay_width() {
  assert_eq!(Config::new(1, 0, 1).overlay(), 0);
}

#[test]
#[should_panic(expected = "overlay width must be in 1..=7")]
fn config_rejects_oversized_overlay_width() {
  assert_eq!(Config::new(1, 8, 1).overlay(), 8);
}

#[test]
#[should_panic(expected = "total qubit width must not exceed 16")]
fn config_rejects_oversized_qubit_sum() {
  assert_eq!(Config::new(10, 7, 1).qubits(), 17);
}

#[test]
#[should_panic(expected = "depth must be in 1..=6")]
fn config_rejects_out_of_range_depth() {
  assert_eq!(Config::new(1, 1, 7).depth(), 7);
}

#[test]
#[should_panic(expected = "depth must be in 1..=6")]
fn config_rejects_zero_depth() {
  assert_eq!(Config::new(1, 1, 0).depth(), 0);
}

#[test]
#[should_panic(expected = "register width must be in 1..=10")]
fn min_domain_rejects_zero_width() {
  assert_eq!(Config::min_domain(0), 0);
}

#[test]
#[should_panic(expected = "register width must be in 1..=10")]
fn min_domain_rejects_oversized_width() {
  assert_eq!(Config::min_domain(11), 0);
}

#[test]
fn index_enumerates_every_basis_state_once() {
  let config = Config::new(3, 2, 1);
  let mut seen: Vec<usize> = (0..config.base_size())
    .flat_map(|base| (0..config.overlay_size()).map(move |overlay| config.index(base, overlay)))
    .collect();
  seen.sort_unstable();
  assert_eq!(seen, (0..1 << config.qubits()).collect::<Vec<_>>());
  assert_eq!(config.index(1, 0), config.overlay_size());
}

#[test]
fn coupling_scale_grows_with_the_square_root_of_depth() {
  let golden_inverse = 2.0 / (1.0 + 5.0_f64.sqrt());
  assert!(coupling_scale(1).overlaps(Interval::decimal(golden_inverse)));
  assert!((coupling_scale(4) / coupling_scale(1)).contains(2.0));
}
