//! Checks source precedence, snapshot retention, and exact-size iterator behavior.

use super::*;
use crate::emotes::tests::example;

#[test]
#[expect(
  clippy::missing_panics_doc,
  reason = "Assertions describe fixture failures"
)]
fn retains_borrowed_records_and_exact_lengths_across_empty_feeds() {
  let feed: Arc<[Emote]> = Arc::from([example("Wave", "provider")]);
  let source = feed.as_ptr();
  let catalog = Catalog::new(
    vec![example("Wave", "added")],
    vec![Arc::from([]), Arc::clone(&feed)],
  );
  drop(feed);
  assert_eq!(catalog.len(), 2);
  assert!(!catalog.is_empty());
  let mut iter = catalog.iter();
  assert_eq!(iter.len(), 2);
  assert_eq!(iter.next().map(|emote| emote.id.as_str()), Some("added"));
  let cloned = iter.clone();
  assert_eq!(cloned.len(), 1);
  assert_eq!(iter.next().map(std::ptr::from_ref), Some(source));
  assert_eq!(iter.size_hint(), (0, Some(0)));
  assert_eq!(iter.next(), None);
  assert_eq!(iter.next(), None);
  assert_eq!(cloned.count(), 1);
  let empty = Catalog::new(vec![], vec![Arc::from([])]);
  assert!(empty.is_empty());
  assert_eq!(empty.into_iter().next(), None);
}
