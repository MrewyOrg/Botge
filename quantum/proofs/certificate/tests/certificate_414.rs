//! Proves Proposition 5.2 and Table 1 of `quantum/docs/botge-quantum.tex` by interval arithmetic
//! across all 414 admissible configurations (computer-assisted certificate).
//!
//! Every metric is an enclosure of the exact real value, so each assertion below is a proof: a
//! bound holds when the whole enclosure satisfies it, and a configuration attains a minimum when
//! its enclosure lies strictly below every other configuration's.

#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use botge_quantum_certificate::{Config, Interval, Metrics, arg_min, collision_entropy, sweep};

#[test]
fn all_414_configurations_meet_the_certificate() {
  let metrics = sweep();
  assert_eq!(metrics.len(), 414);
  for metric in &metrics {
    assert!(
      metric.total.contains(1.0) && metric.total.width() < 1e-9,
      "{:?} is not normalized: {:?}",
      metric.config,
      metric.total
    );
  }

  let check =
    |key: &dyn Fn(&Metrics) -> Interval, expected: Config, holds: &dyn Fn(&Metrics) -> bool| {
      let found = arg_min(&metrics, key);
      assert_eq!(
        found.map(|m| m.config),
        Some(expected),
        "{expected:?} is not the provable unique minimizer"
      );
      assert!(
        found.is_some_and(holds),
        "{expected:?} misses its certified bound"
      );
    };
  let one = Interval::point(1.0);
  check(&|m| m.acceptance, Config::new(9, 7, 5), &|m| {
    m.acceptance.within(0.259_488, 1e-6)
      && (one / m.acceptance).at_most(3.854)
      && (one - m.acceptance).powi(256).within(3.98e-34, 1e-36)
  });
  check(&|m| m.half_quadrant, Config::new(10, 6, 5), &|m| {
    m.half_quadrant.within(0.250_170, 1e-6)
  });
  let overlay_floor = metrics
    .iter()
    .map(|m| m.overlay_acceptance.lo())
    .fold(f64::INFINITY, f64::min);
  check(&|m| m.base_acceptance, Config::new(10, 2, 3), &|m| {
    m.base_acceptance.at_least(0.500_735)
      && m.base_acceptance.within(0.500_735, 1e-6)
      && m.base_acceptance.hi() <= overlay_floor
  });
  check(&Metrics::min_entropy, Config::new(2, 2, 5), &|m| {
    m.min_entropy().at_least(0.9785)
  });
  check(&|m| -m.ratio, Config::new(10, 4, 6), &|m| {
    m.ratio.at_most(3.693)
  });
  check(&|m| m.mutual_information, Config::new(1, 1, 1), &|m| {
    m.mutual_information.at_least(0.067_78)
  });
  check(&|m| m.conditional_entropy, Config::new(10, 1, 6), &|m| {
    m.conditional_entropy.at_least(0.5701)
  });
  check(&|m| m.min_probability, Config::new(10, 6, 3), &|m| {
    m.min_probability.at_least(1.366e-11)
  });

  let sixteen: Vec<Metrics> = metrics
    .iter()
    .filter(|m| m.config.qubits() == 16)
    .cloned()
    .collect();
  let widest = arg_min(&sixteen, Metrics::min_entropy);
  assert_eq!(widest.map(|m| m.config), Some(Config::new(10, 6, 1)));
  assert!(widest.is_some_and(|m| {
    m.overlay_entropy.is_below(m.base_entropy) && m.min_entropy().at_least(0.9897)
  }));
}

#[test]
fn large_registers_keep_strong_correlation_and_conditional_diversity() {
  let mid = Metrics::new(Config::new(9, 7, 3));
  let deep = Metrics::new(Config::new(9, 7, 6));
  assert!(mid.mutual_information.within(0.9513, 1e-4));
  assert!(deep.mutual_information.within(1.8157, 1e-4));
  assert!(mid.median_effective_outcomes.within(66.7, 0.05));
}

#[test]
fn table_one_rows_match_the_simulation() {
  // (n_b, n_o, L, S₂, p_A^min, min H/n, max/min ratio, I(B; O), min P_L)
  let rows = [
    (1, 1, 3, 0.2010, 1.0000, 1.0000, 1.00, 0.1968, 1.22e-1),
    (3, 2, 3, 0.8807, 0.5561, 0.9838, 1.87, 0.6752, 8.65e-4),
    (5, 4, 3, 2.5835, 0.3992, 0.9888, 2.22, 0.7369, 2.24e-6),
    (8, 6, 3, 4.4895, 0.2861, 0.9924, 2.73, 0.8828, 3.51e-9),
    (9, 7, 3, 5.4703, 0.2614, 0.9933, 2.88, 0.9513, 4.21e-10),
    (10, 6, 3, 4.4896, 0.2821, 0.9926, 3.02, 0.8833, 1.37e-11),
    (9, 7, 5, 5.8337, 0.2595, 0.9921, 3.23, 1.1085, 2.50e-10),
    (9, 7, 6, 5.9637, 0.2638, 0.9919, 3.22, 1.8157, 6.25e-11),
  ];
  let min_p_half_ulps = [5e-4, 5e-7, 5e-9, 5e-12, 5e-13, 5e-14, 5e-13, 5e-14];
  for ((base, overlay, depth, s2, acceptance, min_entropy, ratio, information, min_p), half_ulp) in
    rows.into_iter().zip(min_p_half_ulps)
  {
    let config = Config::new(base, overlay, depth);
    let metric = Metrics::new(config);
    assert!(collision_entropy(config).within(s2, 5e-5), "{config:?} S₂");
    assert!(metric.acceptance.within(acceptance, 5e-5), "{config:?} p_A");
    assert!(
      metric.min_entropy().within(min_entropy, 5e-5),
      "{config:?} H/n"
    );
    assert!(metric.ratio.within(ratio, 5e-3), "{config:?} ratio");
    assert!(
      metric.mutual_information.within(information, 5e-5),
      "{config:?} I(B; O)"
    );
    assert!(
      metric.min_probability.within(min_p, half_ulp),
      "{config:?} min P_L"
    );
  }
}
