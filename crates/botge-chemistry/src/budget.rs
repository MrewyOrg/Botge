//! Pool sizing for `/react-emote` (`prop:chem-budget`).

use core::{error::Error, fmt};

/// Smallest pool size accepted for base and overlay pools.
pub(crate) const MIN_POOL: usize = 2;

/// Maximum base pool size `M_b^max = 1024`.
pub(crate) const MAX_BASE_POOL: usize = 1024;

/// Maximum overlay pool size `M_o^max = 128`.
pub(crate) const MAX_OVERLAY_POOL: usize = 128;

/// Capped base and overlay pool sizes `M_b ∈ [2, 1024]` and `M_o ∈ [2, 128]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
  base_pool: u32,
  overlay_pool: u32,
}

impl Budget {
  /// Caps both pools to `[2, 1024]` and `[2, 128]`.
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
    Ok(Self {
      base_pool: capped(base_count, MAX_BASE_POOL),
      overlay_pool: capped(overlay_count, MAX_OVERLAY_POOL),
    })
  }

  /// Number of base emotes `M_b`.
  #[must_use]
  pub const fn base_pool(self) -> u32 {
    self.base_pool
  }

  /// Number of overlay emotes `M_o`.
  #[must_use]
  pub const fn overlay_pool(self) -> u32 {
    self.overlay_pool
  }
}

fn capped(count: usize, cap: usize) -> u32 {
  u32::try_from(count.min(cap)).unwrap_or(u32::MAX)
}

/// Why a chemistry request cannot form a bounded catalog budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BudgetError {
  /// Fewer than two base emotes exist.
  BasePoolTooSmall {
    /// Available base emote count.
    count: usize,
  },
  /// Fewer than two overlay emotes exist.
  OverlayPoolTooSmall {
    /// Available overlay emote count.
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
