//! The honest reply caption: which circuit measured the selection and what it selected.

use core::fmt;

use crate::Selection;

/// Longest emote name, in characters, that a caption repeats.
const MAX_NAME_CHARS: usize = 100;

impl fmt::Display for Selection<'_> {
  /// Names the simulated circuit's width and depth and both drawn emotes as inline code.
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(
      f,
      "Drew `{}` with overlay `{}` from one shot of a simulated {}-qubit Ising-Rx circuit \
       ({} step{}).",
      Name(&self.base.name),
      Name(&self.overlay.name),
      self.qubits,
      self.steps.get(),
      if self.steps.get() == 1 { "" } else { "s" },
    )
  }
}

/// An emote name without backticks, truncated so it cannot break or flood the inline code span.
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
