//! Checks enclosures against exact values and high-precision references.

#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use core::f64::consts::{LN_2, LOG2_10};

use super::*;

/// Asserts that `interval` contains the decimal `expected` and is at most `width` wide.
fn assert_encloses(interval: Interval, expected: f64, width: f64) {
  assert!(
    interval.overlaps(Interval::decimal(expected)),
    "{interval:?} misses {expected}"
  );
  assert!(
    interval.width() <= width,
    "{interval:?} is wider than {width:e}"
  );
}

#[test]
fn arithmetic_encloses_exact_results() {
  let third = Interval::point(1.0) / Interval::point(3.0);
  assert!((third * Interval::point(3.0)).contains(1.0));
  assert!((Interval::decimal(0.1) + Interval::decimal(0.2)).overlaps(Interval::decimal(0.3)));
  assert!((Interval::point(2.0).sqrt().square()).contains(2.0));
  assert!((Interval::point(1.0) - third - third - third).contains(0.0));
  assert_eq!(
    -Interval::from_bounds(1.0, 2.0),
    Interval::from_bounds(-2.0, -1.0)
  );
  assert!(Interval::from_bounds(-2.0, 3.0).square().contains(0.0));
  assert!(Interval::point(0.5).powi(10).contains(1.0 / 1024.0));
  let unit = Interval::from_bounds(0.0, 1.0);
  assert!(!unit.contains(-0.5) && !unit.contains(1.5));
  assert!((Interval::point(1.0) / Interval::from_bounds(-2.0, -1.0)).contains(-0.75));
}

#[test]
fn division_by_an_interval_containing_zero_is_unbounded() {
  let quotient = Interval::point(1.0) / Interval::from_bounds(-1.0, 1.0);
  assert_eq!(quotient, Interval::entire());
}

#[test]
fn comparisons_respect_decimal_literals() {
  let value = Interval::from_bounds(0.25, 0.26);
  assert!(value.at_least(0.25 - 1e-9) && !value.at_least(0.25));
  assert!(value.at_most(0.26 + 1e-9) && !value.at_most(0.26));
  assert!(value.within(0.255, 0.006) && !value.within(0.255, 0.004));
  assert!(Interval::point(1.0).is_below(Interval::point(2.0)));
  assert!(!Interval::from_bounds(1.0, 2.0).is_below(Interval::point(2.0)));
  assert_eq!(
    Interval::from_bounds(1.0, 4.0).min(Interval::from_bounds(2.0, 3.0)),
    Interval::from_bounds(1.0, 3.0)
  );
  assert_eq!(
    Interval::from_bounds(1.0, 4.0).max(Interval::from_bounds(2.0, 3.0)),
    Interval::from_bounds(2.0, 4.0)
  );
}

#[test]
fn constants_enclose_pi_and_ln2() {
  assert_encloses(Interval::pi(), PI, 1e-15);
  assert_encloses(Interval::ln2(), LN_2, 1e-14);
}

#[test]
fn sine_and_cosine_enclose_reference_values() {
  let (sin, cos) = Interval::point(0.0).sin_cos();
  assert!(sin.contains(0.0) && cos.contains(1.0));
  let (sin, cos) = (Interval::pi() / Interval::point(6.0)).sin_cos();
  assert_encloses(sin, 0.5, 1e-14);
  assert_encloses(cos, 0.866_025_403_784_438_6, 1e-14);
  let (sin, cos) = Interval::point(100.0).sin_cos();
  assert_encloses(sin, -0.506_365_641_109_758_8, 1e-12);
  assert_encloses(cos, 0.862_318_872_287_683_9, 1e-12);
  for x in [-7.0, -2.0, 2.0, 3.0, 4.0, 5.0] {
    let (sin, cos) = Interval::point(x).sin_cos();
    assert!(sin.overlaps(Interval::decimal(f64::sin(x))), "sin {x}");
    assert!(cos.overlaps(Interval::decimal(f64::cos(x))), "cos {x}");
    assert!((sin.square() + cos.square()).contains(1.0));
  }
}

#[test]
fn logarithm_and_exponential_enclose_reference_values() {
  assert!(Interval::point(8.0).log2().contains(3.0));
  assert_encloses(Interval::point(0.1).log2(), -LOG2_10, 1e-14);
  assert_encloses(Interval::point(1e-11).log2(), -(11.0 * LOG2_10), 1e-13);
  assert_encloses(Interval::point(0.5).exp2(), SQRT_2, 1e-13);
  for (exponent, power) in [(-1.0, 0.5), (3.0, 8.0), (10.0, 1024.0)] {
    let enclosure = Interval::point(exponent).exp2();
    assert!(enclosure.contains(power), "2^{exponent}: {enclosure:?}");
    assert!(
      enclosure.width() <= power * 1e-11,
      "2^{exponent}: {enclosure:?}"
    );
  }
  assert_eq!(Interval::point(-1.0).log2(), Interval::entire());
  assert_eq!(
    Interval::from_bounds(0.0, 1.0).log2().lo(),
    f64::NEG_INFINITY
  );
}

#[test]
fn entropy_term_covers_endpoints_and_the_peak() {
  assert!(Interval::point(0.0).entropy_term().contains(0.0));
  assert!(Interval::point(1.0).entropy_term().contains(0.0));
  assert_encloses(Interval::point(0.5).entropy_term(), 0.5, 1e-15);
  let around_peak = Interval::from_bounds(0.3, 0.4).entropy_term();
  assert!(around_peak.contains(0.530_737_845_423_043) && around_peak.hi() <= 0.5308);
  let rising = Interval::from_bounds(0.1, 0.2).entropy_term();
  assert!(rising.overlaps(Interval::decimal(0.332_192_809_488_736_2)));
  assert!(rising.overlaps(Interval::decimal(0.464_385_618_977_472_4)));
  let near_one = Interval::from_bounds(0.999_999_999_999_999_9, 1.000_000_000_000_000_2);
  let term = near_one.entropy_term();
  assert!(term.contains(0.0) && term.lo() <= term.hi());
  assert_eq!(
    Interval::from_bounds(1.5, 2.0).entropy_term(),
    Interval::entire()
  );
}

fn assert_valid(interval: Interval) {
  assert!(!interval.lo().is_nan() && !interval.hi().is_nan());
  assert!(interval.lo() <= interval.hi(), "inverted {interval:?}");
}

#[test]
fn unbounded_and_out_of_domain_operations_never_invert() {
  let entire = Interval::entire();
  for value in [
    entire * Interval::point(0.0),
    entire / entire,
    entire + entire,
    entire - entire,
    entire.log2(),
    Interval::from_bounds(-2.0, -1.0).sqrt(),
  ] {
    assert_valid(value);
    assert_eq!(value, Interval::entire());
  }
  let entire_entropy = entire.entropy_term();
  assert_valid(entire_entropy);
  assert!(entire_entropy.contains(0.0) && entire_entropy.contains(0.5));
  for non_negative in [entire.exp2(), entire.sqrt()] {
    assert_valid(non_negative);
    assert_eq!(non_negative, Interval::from_bounds(0.0, f64::INFINITY));
  }
  let (sin, cos) = entire.sin_cos();
  assert_eq!(sin, Interval::from_bounds(-1.0, 1.0));
  assert_eq!(cos, Interval::from_bounds(-1.0, 1.0));

  let straddling = Interval::from_bounds(-1.0, 4.0).sqrt();
  assert_valid(straddling);
  assert!(straddling.contains(0.0) && straddling.contains(2.0));
}

#[test]
fn wide_trig_extreme_logs_exps_and_powi_enclose_targets() {
  let (sin, cos) = Interval::from_bounds(0.0, 0.1).sin_cos();
  assert_valid(sin);
  assert_valid(cos);
  assert!(sin.contains(0.0) && sin.contains(f64::sin(0.1)));
  assert!(cos.contains(1.0) && cos.contains(f64::cos(0.1)));

  assert!(Interval::point(1e-320).log2().hi() < -1060.0);
  assert!(Interval::point(f64::MIN_POSITIVE).log2().contains(-1022.0));
  assert!(Interval::point(1e300).log2().lo() > 996.0);
  let inf_log = Interval::from_bounds(1.0, f64::INFINITY).log2();
  assert_valid(inf_log);
  assert!(inf_log.contains(0.0) && inf_log.hi().is_infinite());

  let neg_inf_exp = Interval::point(f64::NEG_INFINITY).exp2();
  assert_valid(neg_inf_exp);
  assert!(neg_inf_exp.contains(0.0) && neg_inf_exp.lo() >= 0.0);
  let inf_exp = Interval::point(f64::INFINITY).exp2();
  assert_valid(inf_exp);
  assert!(inf_exp.hi().is_infinite());
  let tiny_exp = Interval::point(-1000.0).exp2();
  assert_valid(tiny_exp);
  assert!(tiny_exp.lo() >= 0.0);

  assert_eq!(
    Interval::from_bounds(-3.0, -2.0).powi(0),
    Interval::point(1.0)
  );
  assert!(Interval::from_bounds(-3.0, -2.0).powi(3).contains(-27.0));
  assert!(Interval::from_bounds(-3.0, -2.0).powi(3).contains(-8.0));
}

#[test]
fn nan_bounds_widen_every_operation_to_the_entire_line() {
  let one = Interval::point(1.0);
  let nan_below = Interval::from_bounds(f64::NAN, 1.0);
  let nan_above = Interval::from_bounds(0.5, f64::NAN);
  for value in [
    nan_below.sqrt(),
    nan_above.sqrt(),
    nan_below.log2(),
    nan_above.log2(),
    nan_below.exp2(),
    nan_above.exp2(),
    nan_below.entropy_term(),
    nan_above.entropy_term(),
    nan_below * one,
    nan_above * one,
    one * nan_below,
    one * nan_above,
    nan_below / one,
    nan_above / one,
    one / Interval::from_bounds(f64::NAN, 2.0),
    one / Interval::from_bounds(1.0, f64::NAN),
  ] {
    assert_eq!(value, Interval::entire());
  }
  assert_eq!(exp_at(f64::NAN), Interval::entire());
}

#[test]
fn infinite_bounds_that_cancel_widen_to_the_entire_line() {
  let infinity = Interval::point(f64::INFINITY);
  let non_negative = Interval::from_bounds(0.0, f64::INFINITY);
  for value in [
    infinity + Interval::point(f64::NEG_INFINITY),
    non_negative + Interval::from_bounds(0.0, f64::NEG_INFINITY),
    infinity - infinity,
    non_negative - Interval::from_bounds(f64::INFINITY, 0.0),
    infinity / infinity,
  ] {
    assert_eq!(value, Interval::entire());
  }
  let (sin, cos) = non_negative.sin_cos();
  assert_eq!(sin, Interval::from_bounds(-1.0, 1.0));
  assert_eq!(cos, Interval::from_bounds(-1.0, 1.0));
  assert_eq!(infinity.log2(), infinity);
}
