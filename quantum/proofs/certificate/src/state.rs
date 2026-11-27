//! Interval statevectors of the Ising-Rx circuit, built gate by gate or from the closed form.

use crate::{
  config::{Config, coupling_scale},
  interval::Interval,
};

/// A complex enclosure `(re, im)`.
type Complex = (Interval, Interval);

/// A single-qubit gate `[[a, b], [c, d]]` with complex entries.
type Gate = [[Complex; 2]; 2];

/// Enclosure of a complex statevector over `n_b + n_o` qubits in split real and imaginary parts.
#[derive(Clone, Debug)]
pub struct State {
  pub(crate) re: Vec<Interval>,
  pub(crate) im: Vec<Interval>,
}

impl State {
  /// Closed-form Ising phase state `e^{iγ x̃_b x̃_o} / √(N_b N_o)` followed by the readout layer.
  #[expect(
    clippy::indexing_slicing,
    clippy::cast_precision_loss,
    reason = "Statevector buffers are sized to 2^(n_b + n_o) <= 65_536, which f64 represents exactly"
  )]
  #[must_use]
  pub fn closed_form(config: Config) -> Self {
    let (base_size, overlay_size) = (config.base_size(), config.overlay_size());
    let max_size = Interval::point(base_size.max(overlay_size) as f64);
    let gamma = Interval::point(2.0) * coupling_scale(config.depth()) / max_size;
    let norm = Interval::point(1.0) / Interval::point((base_size * overlay_size) as f64).sqrt();
    // Centered positions are half-integers below 2^10, so these subtractions are exact.
    let (base_center, overlay_center) = (
      (base_size - 1) as f64 / 2.0,
      (overlay_size - 1) as f64 / 2.0,
    );
    let mut state = Self::zeros(config.qubits());
    for base in 0..base_size {
      let centered_base = Interval::point(base as f64 - base_center);
      for overlay in 0..overlay_size {
        let centered_overlay = Interval::point(overlay as f64 - overlay_center);
        let (sin, cos) = (gamma * centered_base * centered_overlay).sin_cos();
        let index = config.index(base, overlay);
        state.re[index] = norm * cos;
        state.im[index] = norm * sin;
      }
    }
    state.apply_readout(config.qubits());
    state
  }

  /// Gate-by-gate circuit: Hadamards, `Rzz(θ_{jl})` for every cross pair, then the readout layer.
  #[expect(
    clippy::indexing_slicing,
    clippy::cast_precision_loss,
    reason = "Statevector buffers are sized to 2^(n_b + n_o) <= 65_536, which f64 represents exactly"
  )]
  #[must_use]
  pub fn gate_by_gate(config: Config) -> Self {
    let (base_size, overlay_size) = (config.base_size(), config.overlay_size());
    let max_size = Interval::point(base_size.max(overlay_size) as f64);
    let scale = coupling_scale(config.depth());
    let mut state = Self::zeros(config.qubits());
    state.re[0] = Interval::point(1.0);
    let (half, zero) = (Interval::point(0.5).sqrt(), Interval::point(0.0));
    state.apply_all(
      config.qubits(),
      [[(half, zero), (half, zero)], [(half, zero), (-half, zero)]],
    );
    for j in 0..config.base() {
      for l in 0..config.overlay() {
        let weight = Interval::point(f64::from(1_u32 << j) * f64::from(1_u32 << l));
        let theta = -scale * weight / max_size;
        let (sin, cos) = (Interval::point(-0.5) * theta).sin_cos();
        for base in 0..base_size {
          for overlay in 0..overlay_size {
            let aligned = ((base >> j) & 1) == ((overlay >> l) & 1);
            let phase_im = if aligned { sin } else { -sin };
            let index = config.index(base, overlay);
            let (re, im) = (state.re[index], state.im[index]);
            state.re[index] = re * cos - im * phase_im;
            state.im[index] = re * phase_im + im * cos;
          }
        }
      }
    }
    state.apply_readout(config.qubits());
    state
  }

  /// Enclosures of the Born probabilities `|ψ_x|²`, indexed by [`Config::index`].
  #[must_use]
  pub fn probabilities(&self) -> Vec<Interval> {
    self
      .re
      .iter()
      .zip(&self.im)
      .map(|(re, im)| re.square() + im.square())
      .collect()
  }

  /// Whether every amplitude enclosure overlaps the matching one of `other`.
  ///
  /// Two enclosures of the same exact state always overlap, so `false` proves the states differ.
  #[must_use]
  pub fn overlaps(&self, other: &Self) -> bool {
    self.re.len() == other.re.len()
      && self
        .re
        .iter()
        .zip(&self.im)
        .zip(other.re.iter().zip(&other.im))
        .all(|((sr, si), (or, oi))| sr.overlaps(*or) && si.overlaps(*oi))
  }

  /// Largest enclosure width over every real and imaginary part.
  #[must_use]
  pub fn max_width(&self) -> f64 {
    self
      .re
      .iter()
      .chain(&self.im)
      .map(|part| part.width())
      .fold(0.0, f64::max)
  }

  fn zeros(qubits: u32) -> Self {
    let dimension = 1 << qubits;
    Self {
      re: vec![Interval::point(0.0); dimension],
      im: vec![Interval::point(0.0); dimension],
    }
  }

  /// Applies the single-qubit `gate` to every qubit.
  #[expect(
    clippy::indexing_slicing,
    reason = "Butterfly indices low and high stay below dimension = 1 << qubits"
  )]
  fn apply_all(&mut self, qubits: u32, gate: Gate) {
    let dimension = 1_usize << qubits;
    let mul = |(gr, gi): Complex, (vr, vi): Complex| (gr * vr - gi * vi, gr * vi + gi * vr);
    for qubit in 0..qubits {
      let step = 1_usize << qubit;
      for start in (0..dimension).step_by(2 * step) {
        for low in start..start + step {
          let high = low + step;
          let zero = (self.re[low], self.im[low]);
          let one = (self.re[high], self.im[high]);
          let (ar, ai) = mul(gate[0][0], zero);
          let (br, bi) = mul(gate[0][1], one);
          let (cr, ci) = mul(gate[1][0], zero);
          let (dr, di) = mul(gate[1][1], one);
          self.re[low] = ar + br;
          self.im[low] = ai + bi;
          self.re[high] = cr + dr;
          self.im[high] = ci + di;
        }
      }
    }
  }

  /// `Rx(-π/4) = cos(π/8) I + i sin(π/8) X` on every qubit.
  #[expect(
    clippy::indexing_slicing,
    reason = "Butterfly indices low and high stay below dimension = 1 << qubits"
  )]
  fn apply_readout(&mut self, qubits: u32) {
    let dimension = 1_usize << qubits;
    let (sin, cos) = (Interval::pi() / Interval::point(8.0)).sin_cos();
    for qubit in 0..qubits {
      let step = 1_usize << qubit;
      for start in (0..dimension).step_by(2 * step) {
        for low in start..start + step {
          let high = low + step;
          let (zero_re, zero_im) = (self.re[low], self.im[low]);
          let (one_re, one_im) = (self.re[high], self.im[high]);
          self.re[low] = cos * zero_re - sin * one_im;
          self.im[low] = cos * zero_im + sin * one_re;
          self.re[high] = cos * one_re - sin * zero_im;
          self.im[high] = cos * one_im + sin * zero_re;
        }
      }
    }
  }
}

#[cfg(test)]
mod tests;
