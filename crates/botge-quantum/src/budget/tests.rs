//! Checks Proposition 2.1: piecewise caps, register widths, half occupancy and the 16-qubit limit.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use super::*;

fn widths(base: usize, overlay: usize) -> Result<(u32, u32, u32, u32), BudgetError> {
  Budget::new(base, overlay).map(|budget| {
    (
      budget.base_pool(),
      budget.overlay_pool(),
      budget.base_bits(),
      budget.overlay_bits(),
    )
  })
}

#[test]
fn sizes_registers_at_the_cap_boundaries() {
  assert_eq!(widths(2, 2), Ok((2, 2, 1, 1)));
  assert_eq!(widths(512, 128), Ok((512, 128, 9, 7)));
  assert_eq!(widths(512, 1000), Ok((512, 128, 9, 7)));
  assert_eq!(widths(513, 65), Ok((513, 64, 10, 6)));
  assert_eq!(widths(1024, 64), Ok((1024, 64, 10, 6)));
  assert_eq!(widths(100_000, 100_000), Ok((1024, 64, 10, 6)));
  assert_eq!(widths(257, 65), Ok((257, 65, 9, 7)));
}

#[test]
fn rejects_pools_without_a_choice() {
  assert_eq!(
    widths(1, 5),
    Err(BudgetError::BasePoolTooSmall { count: 1 })
  );
  assert_eq!(
    widths(5, 0),
    Err(BudgetError::OverlayPoolTooSmall { count: 0 })
  );
  assert_eq!(
    BudgetError::BasePoolTooSmall { count: 1 }.to_string(),
    "the base pool needs at least 2 emotes, found 1"
  );
  assert_eq!(
    BudgetError::OverlayPoolTooSmall { count: 0 }.to_string(),
    "the overlay pool needs at least 2 emotes, found 0"
  );
}

#[test]
fn keeps_every_register_half_occupied_within_sixteen_qubits() {
  let (base_limit, overlay_limit) = if cfg!(miri) { (40, 20) } else { (1100, 200) };
  for base in MIN_POOL..=base_limit {
    for overlay in MIN_POOL..=overlay_limit {
      let budget = Budget::new(base, overlay);
      assert!(budget.is_ok_and(|budget| {
        let occupied = |pool: u32, bits: u32| pool <= 1 << bits && pool > (1 << bits) >> 1;
        budget.qubits() <= 16
          && (1..=10).contains(&budget.base_bits())
          && (1..=7).contains(&budget.overlay_bits())
          && occupied(budget.base_pool(), budget.base_bits())
          && occupied(budget.overlay_pool(), budget.overlay_bits())
          && (budget.base_bits() != 1 || budget.base_pool() == 2)
          && (budget.overlay_bits() != 1 || budget.overlay_pool() == 2)
      }));
    }
  }
}
