//! Deterministic base and overlay pools sliced to the register budget of Proposition 2.1.

use std::collections::HashSet;

use botge_domain::emotes::Emote;

use crate::{Budget, BudgetError};

/// Base and overlay emotes the circuit can address, each sorted and capped by its [`Budget`].
///
/// The order is `(name.to_ascii_lowercase(), id)`, so index `x` names the same emote for the same
/// catalog regardless of provider order; no randomness is involved in choosing the slice.
#[derive(Clone, Debug)]
pub struct Pools<'a> {
  base: Vec<&'a Emote>,
  overlay: Vec<&'a Emote>,
  budget: Budget,
}

impl<'a> Pools<'a> {
  /// Splits a catalog into sorted base and overlay pools and slices their capped prefixes.
  ///
  /// Entries whose name is blank or only backticks, which a caption cannot show, are skipped
  /// first. A repeated provider ID then keeps its first remaining entry, so guild additions listed
  /// first keep their names.
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
      // `sort_by_cached_key` lowercases each name once, which is cheap next to the sidecar call.
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

  /// The register budget the pools were sliced to.
  #[must_use]
  pub const fn budget(&self) -> Budget {
    self.budget
  }

  /// The `M_b` base emotes in index order.
  #[must_use]
  pub fn base(&self) -> &[&'a Emote] {
    &self.base
  }

  /// The `M_o` overlay emotes in index order.
  #[must_use]
  pub fn overlay(&self) -> &[&'a Emote] {
    &self.overlay
  }
}

#[cfg(test)]
mod tests;
