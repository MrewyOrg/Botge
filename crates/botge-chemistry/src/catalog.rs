//! Deterministic sorted base and overlay pools capped to [`Budget`].

use std::collections::HashSet;

use botge_domain::emotes::Emote;

use crate::{Budget, BudgetError};

/// Base and overlay emotes addressed by projected indices, sorted by `(name.to_ascii_lowercase(), id)`.
#[derive(Clone, Debug)]
pub struct Pools<'a> {
  base: Vec<&'a Emote>,
  overlay: Vec<&'a Emote>,
  budget: Budget,
}

impl<'a> Pools<'a> {
  /// Splits a catalog into sorted base and overlay pools and slices their capped prefixes.
  ///
  /// Blank or backtick-only names are omitted first, and duplicate provider IDs keep their first
  /// remaining entry.
  ///
  /// # Errors
  ///
  /// Returns a [`BudgetError`] when fewer than two base or two overlay emotes remain.
  pub fn new(emotes: impl IntoIterator<Item = &'a Emote>) -> Result<Self, BudgetError> {
    let emotes = emotes.into_iter();
    let mut seen = HashSet::with_capacity(emotes.size_hint().0);
    let (mut base, mut overlay): (Vec<_>, Vec<_>) = emotes
      .filter(|emote| {
        emote
          .name
          .chars()
          .any(|character| character != '`' && !character.is_whitespace())
          && seen.insert(emote.id.as_str())
      })
      .partition(|emote| !emote.overlaying);
    let budget = Budget::new(base.len(), overlay.len())?;
    for (pool, size) in [
      (&mut base, budget.base_pool()),
      (&mut overlay, budget.overlay_pool()),
    ] {
      pool.sort_by_cached_key(|&emote: &&'a Emote| {
        (emote.name.to_ascii_lowercase(), emote.id.as_str())
      });
      pool.truncate(usize::try_from(size).unwrap_or(usize::MAX));
    }
    Ok(Self {
      base,
      overlay,
      budget,
    })
  }

  /// The capped pool budget.
  #[must_use]
  pub const fn budget(&self) -> Budget {
    self.budget
  }

  /// The `M_b` base emotes in deterministic index order.
  #[must_use]
  pub fn base(&self) -> &[&'a Emote] {
    &self.base
  }

  /// The `M_o` overlay emotes in deterministic index order.
  #[must_use]
  pub fn overlay(&self) -> &[&'a Emote] {
    &self.overlay
  }

  /// Returns the index of `emote` inside [`Self::base`], if it is present in the sliced base pool.
  #[must_use]
  pub fn base_index_of(&self, emote: &Emote) -> Option<u32> {
    self
      .base
      .iter()
      .position(|candidate| candidate.id == emote.id)
      .and_then(|pos| u32::try_from(pos).ok())
  }
}

#[cfg(test)]
mod tests;
