//! Honest reaction captions and non-reactive explanations with sanitized emote names.

use core::fmt;

use crate::{NoReactionReport, ReactionSelection};

/// Discord emote and reaction names are capped at 100 code points inside inline captions.
const MAX_NAME_CHARS: usize = 100;

impl fmt::Display for ReactionSelection<'_> {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(
      f,
      "`{}` ({}) + `{}` ({}) —[{} · {}]→ `{}` + `{}` ({}, MW {:.2})",
      Name(&self.emote_a.name),
      self.substrate_a_name,
      Name(&self.emote_b.name),
      self.substrate_b_name,
      self.condition_used,
      self.reaction_name,
      Name(&self.base.name),
      Name(&self.overlay.name),
      self.product_formula,
      self.product_mw,
    )
  }
}

impl fmt::Display for NoReactionReport<'_> {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(
      f,
      "No reaction between `{}` ({} — {}) and `{}` ({} — {}): {}",
      Name(&self.emote_a.name),
      self.substrate_a_name,
      self.substrate_a_group,
      Name(&self.emote_b.name),
      self.substrate_b_name,
      self.substrate_b_group,
      self.reason,
    )?;
    if let (Some(cond), Some(rxn)) = (self.hint_condition, &self.hint_reaction) {
      write!(f, " Hint: compatible under `{cond}` ({rxn}).")?;
    }
    Ok(())
  }
}

struct Name<'a>(&'a str);

impl fmt::Display for Name<'_> {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    self
      .0
      .chars()
      .filter(|&character| character != '`')
      .take(MAX_NAME_CHARS)
      .try_for_each(|character| fmt::Write::write_char(f, character))
  }
}

#[cfg(test)]
mod tests;
