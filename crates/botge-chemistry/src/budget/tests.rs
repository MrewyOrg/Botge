#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use super::*;

#[test]
fn budget_caps_pools_and_rejects_under_two() -> anyhow::Result<()> {
  assert_eq!(
    Budget::new(1, 2),
    Err(BudgetError::BasePoolTooSmall { count: 1 })
  );
  assert_eq!(
    Budget::new(2, 1),
    Err(BudgetError::OverlayPoolTooSmall { count: 1 })
  );
  let small = Budget::new(2, 2)?;
  assert_eq!(small.base_pool(), 2);
  assert_eq!(small.overlay_pool(), 2);

  let capped_both = Budget::new(5000, 500)?;
  assert_eq!(capped_both.base_pool(), 1024);
  assert_eq!(capped_both.overlay_pool(), 128);
  assert!(
    BudgetError::BasePoolTooSmall { count: 1 }
      .to_string()
      .contains("base")
  );
  assert!(
    BudgetError::OverlayPoolTooSmall { count: 0 }
      .to_string()
      .contains("overlay")
  );
  Ok(())
}
