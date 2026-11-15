//! Borrows cached provider records while retaining their immutable snapshot owners.
//!
//! Guild additions precede feeds. Replacing a provider cache entry does not invalidate an
//! in-flight catalog: each view owns its old snapshot until the request finishes.
//!
//! # Examples
//!
//! Within the bot crate, normalized feed results can be shared across request views:
//!
//! ```rust,ignore
//! use std::sync::Arc;
//! use crate::emotes::{Emote, catalog::Catalog};
//!
//! # fn request_view(saved: Vec<Emote>, normalized: Vec<Emote>) {
//! let snapshot: Arc<[Emote]> = normalized.into();
//! let request = Catalog::new(saved, vec![Arc::clone(&snapshot)]);
//! drop(snapshot); // The request still owns its snapshot.
//! for emote in &request {
//!   println!("{}", emote.name);
//! }
//! # }
//! ```

use std::{iter::FusedIterator, slice, sync::Arc};

use botge_domain::emotes::Emote;

/// One request's guild additions and shared provider snapshots, in resolution order.
#[derive(Debug)]
pub struct Catalog {
  added: Box<[Emote]>,
  feeds: Box<[Arc<[Emote]>]>,
  len: usize,
}

impl Catalog {
  /// Retains snapshots without cloning their records or strings.
  #[must_use]
  pub fn new(added: Vec<Emote>, feeds: Vec<Arc<[Emote]>>) -> Self {
    let len = added.len() + feeds.iter().map(|feed| feed.len()).sum::<usize>();
    Self {
      added: added.into_boxed_slice(),
      feeds: feeds.into_boxed_slice(),
      len,
    }
  }

  /// Reports the total record count, including duplicate names from different feeds.
  #[must_use]
  pub const fn len(&self) -> usize {
    self.len
  }

  /// Reports whether no source contributed records.
  #[must_use]
  pub const fn is_empty(&self) -> bool {
    self.len == 0
  }

  /// Borrows records in guild-first order without allocating a flattened catalog.
  #[must_use]
  pub fn iter(&self) -> Iter<'_> {
    Iter {
      added: self.added.iter(),
      feeds: self.feeds.iter(),
      current: [].iter(),
      remaining: self.len(),
    }
  }
}

/// A cloneable, exact-size traversal of a catalog's retained snapshots.
#[derive(Clone, Debug)]
pub struct Iter<'a> {
  added: slice::Iter<'a, Emote>,
  feeds: slice::Iter<'a, Arc<[Emote]>>,
  current: slice::Iter<'a, Emote>,
  remaining: usize,
}

impl<'a> Iterator for Iter<'a> {
  type Item = &'a Emote;

  fn next(&mut self) -> Option<Self::Item> {
    let value = self.added.next().or_else(|| {
      loop {
        if let Some(value) = self.current.next() {
          return Some(value);
        }
        self.current = self.feeds.next()?.iter();
      }
    })?;
    self.remaining -= 1;
    Some(value)
  }

  fn size_hint(&self) -> (usize, Option<usize>) {
    (self.remaining, Some(self.remaining))
  }
}

impl ExactSizeIterator for Iter<'_> {}
impl FusedIterator for Iter<'_> {}

impl<'a> IntoIterator for &'a Catalog {
  type Item = &'a Emote;
  type IntoIter = Iter<'a>;

  fn into_iter(self) -> Self::IntoIter {
    self.iter()
  }
}

#[cfg(test)]
mod tests;
