//! Rigorous interval arithmetic: every operation returns an interval containing the exact result.
//!
//! IEEE 754 addition, subtraction, multiplication, division and [`f64::sqrt`] round to nearest, so
//! the exact result lies strictly between the neighbours of the computed value; widening each bound
//! by one step with [`f64::next_down`] and [`f64::next_up`] encloses it. The standard library's
//! `sin`, `ln` and `exp` carry no accuracy guarantee, so this module evaluates them from Taylor and
//! `atanh` series whose truncation error is bounded explicitly and added to the enclosure.

use core::{
  f64::consts::{FRAC_PI_2, PI, SQRT_2},
  iter::Sum,
  ops::{Add, Div, Mul, Neg, Sub},
};
use std::sync::LazyLock;

/// Taylor terms for sine and cosine; at `|y| ≤ 1` the truncation error is below `10⁻³⁰`.
const TRIG_TERMS: u32 = 14;

/// `atanh` series terms; at `|t| ≤ 1/3` the truncation error is below `10⁻²⁸`.
const ATANH_TERMS: u32 = 30;

/// Taylor terms for `exp`; at `|r| ≤ 1/16` the truncation error is below `10⁻³²`.
const EXP_TERMS: u32 = 16;

/// More halvings or doublings than any finite `f64` needs to reach `[1, 2)` or `[-1/16, 1/16]`.
const EXPONENT_STEPS: u32 = 2100;

/// Largest `|r|` the `exp` series is evaluated at; larger arguments are halved and squared back.
const EXP_REDUCED: f64 = 0.0625;

/// Upper bound of `max_{p ∈ [0, 1]} -p log₂ p = 1 / (e ln 2) ≈ 0.530738`.
const PEAK_ENTROPY_TERM: f64 = 0.530_737_845_423_044;

/// Lower and upper bounds of the maximizer `1/e ≈ 0.367879` of `-p log₂ p`.
const PEAK_LOW: f64 = 0.367_879_441_171_442;
const PEAK_HIGH: f64 = 0.367_879_441_171_443;

/// Cached enclosure of `ln 2 = 2 atanh(1/3)`.
static LN2: LazyLock<Interval> =
  LazyLock::new(|| atanh(Interval::point(1.0) / Interval::point(3.0)) * Interval::point(2.0));

/// Closed interval `[lo, hi]` of reals that contains the exact value it stands for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Interval {
  lo: f64,
  hi: f64,
}

impl Interval {
  /// The exactly representable value `value`, with no widening.
  #[must_use]
  pub const fn point(value: f64) -> Self {
    Self {
      lo: value,
      hi: value,
    }
  }

  /// An enclosure of the real number a decimal literal denotes, such as `0.9785`.
  ///
  /// Parsing rounds the literal to the nearest `f64`, so widening by one step each way contains
  /// the exact decimal.
  #[must_use]
  pub const fn decimal(value: f64) -> Self {
    Self::widened(value, value)
  }

  /// Every real number; the result of dividing by an interval that contains zero.
  #[must_use]
  pub const fn entire() -> Self {
    Self {
      lo: f64::NEG_INFINITY,
      hi: f64::INFINITY,
    }
  }

  /// An enclosure of `π`.
  #[must_use]
  pub const fn pi() -> Self {
    Self::widened(PI, PI)
  }

  /// An enclosure of `ln 2 = 2 atanh(1/3)`.
  #[must_use]
  pub fn ln2() -> Self {
    *LN2
  }

  /// Lower bound.
  #[must_use]
  pub const fn lo(self) -> f64 {
    self.lo
  }

  /// Upper bound.
  #[must_use]
  pub const fn hi(self) -> f64 {
    self.hi
  }

  /// Whether `value` lies in the interval.
  #[must_use]
  pub fn contains(self, value: f64) -> bool {
    self.lo <= value && value <= self.hi
  }

  /// Whether the two intervals share a point, as two enclosures of the same real must.
  #[must_use]
  pub fn overlaps(self, other: Self) -> bool {
    self.lo <= other.hi && other.lo <= self.hi
  }

  /// An upper bound of `hi - lo`.
  #[must_use]
  pub fn width(self) -> f64 {
    (self.hi - self.lo).next_up()
  }

  /// Whether every point lies strictly below every point of `other`.
  #[must_use]
  pub fn is_below(self, other: Self) -> bool {
    self.hi < other.lo
  }

  /// Whether the exact value is at least the decimal `bound`.
  #[must_use]
  pub fn at_least(self, bound: f64) -> bool {
    self.lo >= Self::decimal(bound).hi
  }

  /// Whether the exact value is at most the decimal `bound`.
  #[must_use]
  pub fn at_most(self, bound: f64) -> bool {
    self.hi <= Self::decimal(bound).lo
  }

  /// Whether the exact value lies strictly within `tolerance` of the decimal `center`.
  #[must_use]
  pub fn within(self, center: f64, tolerance: f64) -> bool {
    let (center, tolerance) = (Self::decimal(center), Self::decimal(tolerance));
    self.lo > (center - tolerance).hi && self.hi < (center + tolerance).lo
  }

  /// An enclosure of the smaller of two exact values.
  #[must_use]
  pub const fn min(self, other: Self) -> Self {
    Self {
      lo: self.lo.min(other.lo),
      hi: self.hi.min(other.hi),
    }
  }

  /// An enclosure of the larger of two exact values.
  #[must_use]
  pub const fn max(self, other: Self) -> Self {
    Self {
      lo: self.lo.max(other.lo),
      hi: self.hi.max(other.hi),
    }
  }

  /// An enclosure of `x²`, which is never negative.
  #[must_use]
  pub fn square(self) -> Self {
    let (near, far) = if self.lo <= 0.0 && self.hi >= 0.0 {
      (0.0, self.magnitude())
    } else {
      (self.lo.abs().min(self.hi.abs()), self.magnitude())
    };
    Self {
      lo: (near * near).next_down().max(0.0),
      hi: (far * far).next_up(),
    }
  }

  /// An enclosure of `x^exponent`.
  #[must_use]
  pub fn powi(self, mut exponent: u32) -> Self {
    let mut base = self;
    let mut result = Self::point(1.0);
    while exponent > 0 {
      if exponent % 2 == 1 {
        result = result * base;
      }
      exponent /= 2;
      if exponent > 0 {
        base = base.square();
      }
    }
    result
  }

  /// An enclosure of `√x` for a non-negative `x`; unbounded when `x` may be negative.
  #[must_use]
  pub fn sqrt(self) -> Self {
    if self.lo.is_nan() || self.hi.is_nan() || self.hi < 0.0 {
      return Self::entire();
    }
    Self {
      lo: self.lo.max(0.0).sqrt().next_down().max(0.0),
      hi: self.hi.sqrt().next_up(),
    }
  }

  /// Enclosures of `(sin x, cos x)`.
  ///
  /// Both functions are 1-Lipschitz, so the enclosure at an interior point widens by the radius.
  #[must_use]
  pub fn sin_cos(self) -> (Self, Self) {
    if !self.lo.is_finite() || !self.hi.is_finite() {
      return (Self::from_bounds(-1.0, 1.0), Self::from_bounds(-1.0, 1.0));
    }
    let middle = f64::midpoint(self.lo, self.hi).max(self.lo).min(self.hi);
    let radius = (Self::point(self.hi) - Self::point(middle))
      .hi
      .max((Self::point(middle) - Self::point(self.lo)).hi);
    let (sin, cos) = sin_cos_at(middle);
    (
      sin.plus_minus(radius).clamp_unit(),
      cos.plus_minus(radius).clamp_unit(),
    )
  }

  /// An enclosure of `log₂ x`; unbounded below when `x` may be zero.
  #[must_use]
  pub fn log2(self) -> Self {
    if self.lo.is_nan() || self.hi.is_nan() || self.hi <= 0.0 {
      return Self::entire();
    }
    let lo = if self.lo.is_infinite() && self.lo.is_sign_positive() {
      f64::INFINITY
    } else if self.lo > 0.0 {
      log2_at(self.lo).lo
    } else {
      f64::NEG_INFINITY
    };
    let hi = if self.hi.is_infinite() {
      f64::INFINITY
    } else {
      log2_at(self.hi).hi
    };
    Self { lo, hi }
  }

  /// An enclosure of `2^x`.
  #[must_use]
  pub fn exp2(self) -> Self {
    if self.lo.is_nan() || self.hi.is_nan() {
      return Self::entire();
    }
    let exponent = self * Self::ln2();
    Self {
      lo: exp_at(exponent.lo).lo,
      hi: exp_at(exponent.hi).hi,
    }
  }

  /// An enclosure of the entropy term `-p log₂ p` of a probability `p`, with `0 log 0 = 0`.
  ///
  /// The term is concave on `[0, 1]`, increasing up to `1/e` and decreasing after it, so its
  /// minimum lies at an endpoint and its maximum at an endpoint or at `1/e`.
  #[must_use]
  pub fn entropy_term(self) -> Self {
    if self.lo.is_nan() || self.hi.is_nan() || self.lo > 1.0 || self.hi < 0.0 {
      return Self::entire();
    }
    let (low, high) = (self.lo.max(0.0), self.hi.min(1.0));
    let term = |p: f64| {
      if p > 0.0 {
        -(Self::point(p) * log2_at(p))
      } else {
        Self::point(0.0)
      }
    };
    let (at_low, at_high) = (term(low), term(high));
    Self {
      lo: at_low.lo.min(at_high.lo).max(0.0),
      hi: if low <= PEAK_HIGH && high >= PEAK_LOW {
        PEAK_ENTROPY_TERM
      } else {
        at_low.hi.max(at_high.hi)
      },
    }
  }

  /// `[lo, hi]` from bounds the caller has already made rigorous.
  pub(crate) const fn from_bounds(lo: f64, hi: f64) -> Self {
    Self { lo, hi }
  }

  /// `[lo, hi]` widened one step each way to absorb round-to-nearest error.
  const fn widened(lo: f64, hi: f64) -> Self {
    Self {
      lo: lo.next_down(),
      hi: hi.next_up(),
    }
  }

  /// Largest absolute value in the interval.
  const fn magnitude(self) -> f64 {
    self.lo.abs().max(self.hi.abs())
  }

  /// The interval widened by `radius` on each side.
  fn plus_minus(self, radius: f64) -> Self {
    self + Self::from_bounds(-radius, radius)
  }

  /// The interval intersected with `[-1, 1]`, the range of sine and cosine.
  const fn clamp_unit(self) -> Self {
    Self {
      lo: self.lo.max(-1.0),
      hi: self.hi.min(1.0),
    }
  }
}

impl Add for Interval {
  type Output = Self;

  fn add(self, rhs: Self) -> Self {
    let (lo, hi) = (self.lo + rhs.lo, self.hi + rhs.hi);
    if lo.is_nan() || hi.is_nan() {
      return Self::entire();
    }
    Self::widened(lo, hi)
  }
}

impl Sub for Interval {
  type Output = Self;

  fn sub(self, rhs: Self) -> Self {
    let (lo, hi) = (self.lo - rhs.hi, self.hi - rhs.lo);
    if lo.is_nan() || hi.is_nan() {
      return Self::entire();
    }
    Self::widened(lo, hi)
  }
}

impl Neg for Interval {
  type Output = Self;

  fn neg(self) -> Self {
    Self {
      lo: -self.hi,
      hi: -self.lo,
    }
  }
}

impl Mul for Interval {
  type Output = Self;

  fn mul(self, rhs: Self) -> Self {
    if self.lo.is_nan() || self.hi.is_nan() || rhs.lo.is_nan() || rhs.hi.is_nan() {
      return Self::entire();
    }
    let products = [
      self.lo * rhs.lo,
      self.lo * rhs.hi,
      self.hi * rhs.lo,
      self.hi * rhs.hi,
    ];
    if products.iter().any(|product| product.is_nan()) {
      return Self::entire();
    }
    Self::widened(
      products.iter().copied().fold(f64::INFINITY, f64::min),
      products.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    )
  }
}

impl Div for Interval {
  type Output = Self;

  fn div(self, rhs: Self) -> Self {
    if self.lo.is_nan()
      || self.hi.is_nan()
      || rhs.lo.is_nan()
      || rhs.hi.is_nan()
      || (rhs.lo <= 0.0 && rhs.hi >= 0.0)
    {
      return Self::entire();
    }
    let quotients = [
      self.lo / rhs.lo,
      self.lo / rhs.hi,
      self.hi / rhs.lo,
      self.hi / rhs.hi,
    ];
    if quotients.iter().any(|quotient| quotient.is_nan()) {
      return Self::entire();
    }
    Self::widened(
      quotients.iter().copied().fold(f64::INFINITY, f64::min),
      quotients.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    )
  }
}

impl Sum for Interval {
  fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
    iter.fold(Self::point(0.0), Add::add)
  }
}

/// `atanh t = Σ t^{2k+1} / (2k+1)` for `|t| < 1`, with the tail bounded by
/// `|t|^{2K+1} / ((2K+1)(1 - t²))`.
fn atanh(t: Interval) -> Interval {
  let t_squared = t.square();
  let mut power = t;
  let mut sum = Interval::point(0.0);
  for k in 0..ATANH_TERMS {
    sum = sum + power / Interval::point(f64::from(2 * k + 1));
    power = power * t_squared;
  }
  let tail = Interval::point(power.magnitude())
    / (Interval::point(f64::from(2 * ATANH_TERMS + 1)) * (Interval::point(1.0) - t_squared));
  sum.plus_minus(tail.hi)
}

/// An enclosure of `log₂ x` at a positive, finite `x`.
///
/// Exact halving and doubling write `x = m 2^e` with `m ∈ [√2/2, √2]`; then
/// `ln m = 2 atanh((m - 1)/(m + 1))` with `|(m - 1)/(m + 1)| ≤ 0.172`.
fn log2_at(x: f64) -> Interval {
  let (mut mantissa, mut exponent) = (x, 0_i32);
  for _ in 0..EXPONENT_STEPS {
    if mantissa < 2.0 {
      break;
    }
    mantissa /= 2.0;
    exponent += 1;
  }
  for _ in 0..EXPONENT_STEPS {
    if mantissa >= 1.0 {
      break;
    }
    mantissa *= 2.0;
    exponent -= 1;
  }
  if mantissa > SQRT_2 {
    mantissa /= 2.0;
    exponent += 1;
  }
  let (m, one) = (Interval::point(mantissa), Interval::point(1.0));
  atanh((m - one) / (m + one)) * Interval::point(2.0) / Interval::ln2()
    + Interval::point(f64::from(exponent))
}

/// An enclosure of `e^x`.
///
/// Exact halving brings `|x| / 2^s` within [`EXP_REDUCED`]; the Taylor tail there is at most
/// `e^{1/16} |r|^K / K! < 2 |r|^K / K!`; squaring `s` times restores `e^x`.
fn exp_at(x: f64) -> Interval {
  if x.is_nan() {
    return Interval::entire();
  }
  if x.is_infinite() {
    return if x.is_sign_negative() {
      Interval::point(0.0)
    } else {
      Interval::point(f64::INFINITY)
    };
  }
  let (mut reduced, mut squarings) = (x, 0_u32);
  for _ in 0..EXPONENT_STEPS {
    if reduced.abs() <= EXP_REDUCED {
      break;
    }
    reduced /= 2.0;
    squarings += 1;
  }
  let r = Interval::point(reduced);
  let mut term = Interval::point(1.0);
  let mut sum = Interval::point(0.0);
  for k in 1..=EXP_TERMS {
    sum = sum + term;
    term = term * r / Interval::point(f64::from(k));
  }
  let tail = (Interval::point(2.0) * Interval::point(term.magnitude())).hi;
  (0..squarings).fold(sum.plus_minus(tail), |value, _| value.square())
}

/// Enclosures of `(sin x, cos x)` at a finite `x`.
///
/// `x = k π/2 + y` with an integer `k`; the Lagrange remainder bounds the Taylor tail for any `y`,
/// and `k mod 4` maps `(sin y, cos y)` to the right quadrant.
fn sin_cos_at(x: f64) -> (Interval, Interval) {
  let quarter_turns = (x / FRAC_PI_2).round();
  let y =
    Interval::point(x) - Interval::point(quarter_turns) * (Interval::pi() / Interval::point(2.0));
  let y_squared = y.square();
  let (mut sin_term, mut cos_term) = (y, Interval::point(1.0));
  let (mut sin, mut cos) = (Interval::point(0.0), Interval::point(0.0));
  for k in 0..TRIG_TERMS {
    sin = sin + sin_term;
    cos = cos + cos_term;
    sin_term = -(sin_term * y_squared / Interval::point(f64::from((2 * k + 2) * (2 * k + 3))));
    cos_term = -(cos_term * y_squared / Interval::point(f64::from((2 * k + 1) * (2 * k + 2))));
  }
  let (sin, cos) = (
    sin.plus_minus(sin_term.magnitude()),
    cos.plus_minus(cos_term.magnitude()),
  );
  let quadrant = quarter_turns.rem_euclid(4.0);
  if quadrant < 0.5 {
    (sin, cos)
  } else if quadrant < 1.5 {
    (cos, -sin)
  } else if quadrant < 2.5 {
    (-sin, -cos)
  } else {
    (-cos, sin)
  }
}

#[cfg(test)]
mod tests;
