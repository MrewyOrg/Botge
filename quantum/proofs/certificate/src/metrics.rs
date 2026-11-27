//! Enclosures of every quantity Proposition 5.2 and Table 1 bound, from one simulated Born law.

use crate::{
  config::{Config, admissible},
  entropy::entropy,
  interval::Interval,
  state::State,
};

/// Enclosures of every metric the certificate reports for one configuration.
#[derive(Clone, Debug)]
pub struct Metrics {
  /// The simulated configuration.
  pub config: Config,
  /// Total probability; contains one.
  pub total: Interval,
  /// Joint acceptance `p_A` on the smallest admissible pools.
  pub acceptance: Interval,
  /// Probability that both registers land in their lower halves.
  pub half_quadrant: Interval,
  /// Base marginal acceptance on the smallest admissible base pool.
  pub base_acceptance: Interval,
  /// Overlay marginal acceptance on the smallest admissible overlay pool.
  pub overlay_acceptance: Interval,
  /// Base marginal entropy per qubit, `H(B) / n_b`.
  pub base_entropy: Interval,
  /// Overlay marginal entropy per qubit, `H(O) / n_o`.
  pub overlay_entropy: Interval,
  /// Larger max/min ratio of the two marginal distributions.
  pub ratio: Interval,
  /// Mutual information `I(B; O)` in bits.
  pub mutual_information: Interval,
  /// Smaller conditional entropy per qubit of either register given the other.
  pub conditional_entropy: Interval,
  /// Smallest joint outcome probability `min P_L`.
  pub min_probability: Interval,
  /// Median over base outcomes of the effective number of overlay outcomes `2^{H(O | b)}`.
  pub median_effective_outcomes: Interval,
}

impl Metrics {
  /// Simulates `config` and encloses every certified metric of its Born law.
  #[expect(
    clippy::indexing_slicing,
    reason = "Base and overlay indices stay within config register sizes and min_domain bounds"
  )]
  #[must_use]
  pub fn new(config: Config) -> Self {
    let probabilities = State::closed_form(config).probabilities();
    let (base_size, overlay_size) = (config.base_size(), config.overlay_size());
    let joint = |base: usize, overlay: usize| probabilities[config.index(base, overlay)];
    let base_marginal: Vec<Interval> = (0..base_size)
      .map(|b| (0..overlay_size).map(|o| joint(b, o)).sum())
      .collect();
    let overlay_marginal: Vec<Interval> = (0..overlay_size)
      .map(|o| (0..base_size).map(|b| joint(b, o)).sum())
      .collect();
    let rectangle = |base_end: usize, overlay_end: usize| -> Interval {
      (0..base_end)
        .map(|b| (0..overlay_end).map(|o| joint(b, o)).sum::<Interval>())
        .sum()
    };
    let (base_min, overlay_min) = (
      Config::min_domain(config.base()),
      Config::min_domain(config.overlay()),
    );
    let (base_entropy, overlay_entropy, joint_entropy) = (
      entropy(&base_marginal),
      entropy(&overlay_marginal),
      entropy(&probabilities),
    );
    let spread = |marginal: &[Interval]| {
      let max = marginal
        .iter()
        .fold(Interval::point(f64::NEG_INFINITY), |a, b| a.max(*b));
      let min = marginal
        .iter()
        .fold(Interval::point(f64::INFINITY), |a, b| a.min(*b));
      max / min
    };
    let effective: Vec<Interval> = (0..base_size)
      .map(|b| {
        (0..overlay_size)
          .map(|o| (joint(b, o) / base_marginal[b]).entropy_term())
          .sum::<Interval>()
          .exp2()
      })
      .collect();
    let (base_bits, overlay_bits) = (
      Interval::point(f64::from(config.base())),
      Interval::point(f64::from(config.overlay())),
    );
    Self {
      config,
      total: probabilities.iter().copied().sum(),
      acceptance: rectangle(base_min, overlay_min),
      half_quadrant: rectangle(base_size / 2, overlay_size / 2),
      base_acceptance: base_marginal[..base_min].iter().copied().sum(),
      overlay_acceptance: overlay_marginal[..overlay_min].iter().copied().sum(),
      base_entropy: base_entropy / base_bits,
      overlay_entropy: overlay_entropy / overlay_bits,
      ratio: spread(&base_marginal).max(spread(&overlay_marginal)),
      mutual_information: base_entropy + overlay_entropy - joint_entropy,
      conditional_entropy: ((joint_entropy - base_entropy) / overlay_bits)
        .min((joint_entropy - overlay_entropy) / base_bits),
      min_probability: probabilities
        .iter()
        .fold(Interval::point(f64::INFINITY), |a, b| a.min(*b)),
      median_effective_outcomes: median(&effective),
    }
  }

  /// Smaller per-qubit marginal entropy of the two registers.
  #[must_use]
  pub const fn min_entropy(&self) -> Interval {
    self.base_entropy.min(self.overlay_entropy)
  }
}

/// An enclosure of the median of the exact values that `values` enclose.
///
/// Each order statistic is non-decreasing in every argument, so the order statistics of the lower
/// and upper bounds bracket it.
#[expect(
  clippy::indexing_slicing,
  reason = "Caller passes a non-empty slice and sorted bound vectors have the same length"
)]
fn median(values: &[Interval]) -> Interval {
  let mut lows: Vec<f64> = values.iter().map(|value| value.lo()).collect();
  let mut highs: Vec<f64> = values.iter().map(|value| value.hi()).collect();
  lows.sort_by(f64::total_cmp);
  highs.sort_by(f64::total_cmp);
  let (lower, upper) = ((values.len() - 1) / 2, values.len() / 2);
  (Interval::from_bounds(lows[lower], highs[lower])
    + Interval::from_bounds(lows[upper], highs[upper]))
    / Interval::point(2.0)
}

/// Metrics for every configuration in [`admissible`], in the same order.
#[must_use]
pub fn sweep() -> Vec<Metrics> {
  admissible().into_iter().map(Metrics::new).collect()
}

/// The metrics whose `key` is provably smaller than every other entry's.
///
/// Returns `None` when `metrics` is empty or when no entry's enclosure lies strictly below all the
/// others, so a returned entry is the unique exact minimizer.
pub fn arg_min(metrics: &[Metrics], key: impl Fn(&Metrics) -> Interval) -> Option<&Metrics> {
  let best = metrics
    .iter()
    .min_by(|a, b| key(a).lo().total_cmp(&key(b).lo()))?;
  let bound = key(best);
  metrics
    .iter()
    .filter(|other| !core::ptr::eq(*other, best))
    .all(|other| bound.is_below(key(other)))
    .then_some(best)
}

#[cfg(test)]
mod tests;
