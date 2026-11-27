//! Checks the derived metrics against the closed-form 2-by-2 law of Corollary 4.4.

#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use super::*;
use crate::config::coupling_scale;

#[test]
fn two_by_two_metrics_follow_corollary_4_4() {
  let one = Interval::point(1.0);
  for depth in 1..=6 {
    let metrics = Metrics::new(Config::new(1, 1, depth));
    let (correlation, _) = (coupling_scale(depth) / Interval::point(2.0)).sin_cos();
    let agree = (one + correlation) / Interval::point(2.0);
    let information = one - entropy(&[agree, one - agree]);
    assert!(metrics.total.contains(1.0));
    assert!(metrics.base_entropy.contains(1.0) && metrics.overlay_entropy.contains(1.0));
    assert!(
      metrics.mutual_information.overlaps(information),
      "L = {depth}"
    );
    assert!(
      metrics
        .min_probability
        .overlaps((one - correlation) / Interval::point(4.0))
    );
  }
}

#[test]
fn median_brackets_the_middle_order_statistics() {
  let values = [
    Interval::from_bounds(3.0, 3.5),
    Interval::from_bounds(1.0, 1.5),
    Interval::from_bounds(2.0, 2.5),
    Interval::from_bounds(4.0, 4.5),
  ];
  let middle = median(&values);
  assert!(middle.contains(2.5) && middle.contains(3.0) && middle.width() < 0.5 + 1e-12);
  assert!(median(&values[..3]).contains(2.0));
}

#[test]
fn arg_min_requires_a_provably_unique_minimizer() {
  let metrics: Vec<Metrics> = [3, 1, 2]
    .into_iter()
    .map(|depth| Metrics::new(Config::new(1, 1, depth)))
    .collect();
  let found = arg_min(&metrics, |m| m.mutual_information);
  assert_eq!(found.map(|m| m.config.depth()), Some(1));
  assert!(arg_min(&metrics, |_| Interval::point(1.0)).is_none());
  assert!(arg_min(&[], |m: &Metrics| m.total).is_none());
}
