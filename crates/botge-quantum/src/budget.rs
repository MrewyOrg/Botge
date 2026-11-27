//! Register sizing for the quantum emote circuit (Proposition 2.1).

use core::{error::Error, fmt};

/// Smallest pool the circuit samples from; a single emote leaves nothing to entangle.
pub(crate) const MIN_POOL: usize = 2;

/// Largest base pool that still uses the narrow `(512, 128)` cap.
const NARROW_BASE_LIMIT: usize = 512;

/// Pool caps `(M_b^max, M_o^max)` when the base pool fits the narrow branch: 9 + 7 qubits.
const NARROW_CAPS: (usize, usize) = (512, 128);

/// Pool caps `(M_b^max, M_o^max)` for larger base pools: 10 + 6 qubits.
const WIDE_CAPS: (usize, usize) = (1024, 64);

/// Register budget for one quantum emote request.
///
/// Each pool is capped piecewise, `n = ⌈log₂ M⌉` qubits address it, and every register is more than
/// half occupied (`N / 2 < M ≤ N`), so the circuit uses at most sixteen qubits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
  base_pool: u32,
  overlay_pool: u32,
  base_bits: u32,
  overlay_bits: u32,
}

impl Budget {
  /// Caps both pools and sizes their registers.
  ///
  /// # Errors
  ///
  /// Returns [`BudgetError::BasePoolTooSmall`] or [`BudgetError::OverlayPoolTooSmall`] when a pool
  /// holds fewer than two emotes.
  pub fn new(base_count: usize, overlay_count: usize) -> Result<Self, BudgetError> {
    if base_count < MIN_POOL {
      return Err(BudgetError::BasePoolTooSmall { count: base_count });
    }
    if overlay_count < MIN_POOL {
      return Err(BudgetError::OverlayPoolTooSmall {
        count: overlay_count,
      });
    }
    let (base_cap, overlay_cap) = if base_count <= NARROW_BASE_LIMIT {
      NARROW_CAPS
    } else {
      WIDE_CAPS
    };
    let base_pool = capped(base_count, base_cap);
    let overlay_pool = capped(overlay_count, overlay_cap);
    Ok(Self {
      base_pool,
      overlay_pool,
      base_bits: bits(base_pool),
      overlay_bits: bits(overlay_pool),
    })
  }

  /// Number of base emotes the circuit samples from, `M_b`.
  #[must_use]
  pub const fn base_pool(self) -> u32 {
    self.base_pool
  }

  /// Number of overlay emotes the circuit samples from, `M_o`.
  #[must_use]
  pub const fn overlay_pool(self) -> u32 {
    self.overlay_pool
  }

  /// Base register width `n_b = ⌈log₂ M_b⌉`, between 1 and 10.
  #[must_use]
  pub const fn base_bits(self) -> u32 {
    self.base_bits
  }

  /// Overlay register width `n_o = ⌈log₂ M_o⌉`, between 1 and 7.
  #[must_use]
  pub const fn overlay_bits(self) -> u32 {
    self.overlay_bits
  }

  /// Total circuit width `n_b + n_o`, at most 16.
  #[must_use]
  pub const fn qubits(self) -> u32 {
    self.base_bits + self.overlay_bits
  }
}

/// Caps `count` at `cap`; both caps fit in `u32`.
fn capped(count: usize, cap: usize) -> u32 {
  u32::try_from(count.min(cap)).unwrap_or(u32::MAX)
}

/// Register width `⌈log₂ pool⌉` for a pool of at least two emotes.
const fn bits(pool: u32) -> u32 {
  pool.next_power_of_two().trailing_zeros()
}

/// Why a quantum emote request cannot form a register budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BudgetError {
  /// The base pool holds fewer than two emotes.
  BasePoolTooSmall {
    /// Number of base emotes available.
    count: usize,
  },
  /// The overlay pool holds fewer than two emotes.
  OverlayPoolTooSmall {
    /// Number of overlay emotes available.
    count: usize,
  },
}

impl fmt::Display for BudgetError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let (pool, count) = match *self {
      Self::BasePoolTooSmall { count } => ("base", count),
      Self::OverlayPoolTooSmall { count } => ("overlay", count),
    };
    write!(
      f,
      "the {pool} pool needs at least {MIN_POOL} emotes, found {count}"
    )
  }
}

impl Error for BudgetError {}

#[cfg(test)]
mod tests;
