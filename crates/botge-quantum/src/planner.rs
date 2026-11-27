//! Maps sliced pools to a sidecar request and checks the measured indices against them.

use botge_domain::emotes::Emote;

use crate::{EntangleRequest, Pools, QuantumError, Sample, Steps};

/// One `/quantum-emote` request: the sliced pools and the circuit depth.
#[derive(Clone, Debug)]
pub struct Plan<'a> {
  pools: Pools<'a>,
  steps: Steps,
}

impl<'a> Plan<'a> {
  /// Pairs the pools with the requested number of coupling steps.
  #[must_use]
  pub const fn new(pools: Pools<'a>, steps: Steps) -> Self {
    Self { pools, steps }
  }

  /// The sidecar request: `M_b`, `M_o` and `L`, whose widths fit sixteen qubits by construction.
  #[must_use]
  pub const fn request(&self) -> EntangleRequest {
    let budget = self.pools.budget();
    EntangleRequest {
      base_pool_size: budget.base_pool(),
      overlay_pool_size: budget.overlay_pool(),
      steps: self.steps,
    }
  }

  /// Maps a measured sample back to the emotes it addresses.
  ///
  /// # Errors
  ///
  /// Returns [`QuantumError::Invalid`] when the sample's circuit width differs from the budget or
  /// an index falls outside its pool; such a sample did not come from this request.
  pub fn resolve(&self, sample: &Sample) -> Result<Selection<'a>, QuantumError> {
    let index = |value: u32| usize::try_from(value).ok();
    let base = index(sample.base_index).and_then(|index| self.pools.base().get(index));
    let overlay = index(sample.overlay_index).and_then(|index| self.pools.overlay().get(index));
    match (base, overlay) {
      (Some(&base), Some(&overlay)) if sample.qubits == self.pools.budget().qubits() => {
        Ok(Selection {
          base,
          overlay,
          qubits: sample.qubits,
          steps: self.steps,
        })
      }
      _ => Err(QuantumError::Invalid),
    }
  }
}

/// The base and overlay emotes one accepted shot selected, with the circuit that measured them.
///
/// Its [`Display`](core::fmt::Display) form is the reply caption.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Selection<'a> {
  pub(crate) base: &'a Emote,
  pub(crate) overlay: &'a Emote,
  pub(crate) qubits: u32,
  pub(crate) steps: Steps,
}

impl<'a> Selection<'a> {
  /// The drawn base emote.
  #[must_use]
  pub const fn base(&self) -> &'a Emote {
    self.base
  }

  /// The drawn overlay emote, drawn over [`Self::base`].
  #[must_use]
  pub const fn overlay(&self) -> &'a Emote {
    self.overlay
  }
}

#[cfg(test)]
mod tests;
