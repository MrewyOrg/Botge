//! Unpredictable tokens and shuffling for short-lived game state.

use std::{
  hash::{BuildHasher as _, RandomState},
  sync::atomic::{AtomicU64, Ordering},
};

/// Returns 64 unpredictable bits from the standard library's randomly keyed hasher.
///
/// Each [`RandomState`] is keyed from operating-system randomness, so the output cannot be
/// predicted without the key. It guards short-lived game tickets and image tokens only.
pub(super) fn random() -> u64 {
  static COUNTER: AtomicU64 = AtomicU64::new(0);
  RandomState::new().hash_one(COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Returns a 128-bit random token as 32 hex digits.
pub(crate) fn token() -> String {
  format!("{:016x}{:016x}", random(), random())
}

/// Shuffles in place with a Fisher–Yates pass.
pub(super) fn shuffle<T>(items: &mut [T]) {
  for index in (1..items.len()).rev() {
    let bound = u64::try_from(index).unwrap_or(u64::MAX).saturating_add(1);
    let other = usize::try_from(random() % bound).unwrap_or(0);
    items.swap(index, other);
  }
}
