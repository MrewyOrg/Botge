#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use super::*;

#[test]
fn fnv1a_matches_standard_vectors_and_python_buckets() {
  assert_eq!(fnv1a_64(b""), 0xcbf2_9ce4_8422_2325);
  assert_eq!(fnv1a_64(b"foobar"), 0x8594_4171_f739_67e8);
  let idx = substrate_index("01H00000000000000000000000");
  assert!(idx.get() < ATLAS_SIZE);
  assert_eq!(substrate("01H00000000000000000000000"), idx.info());
  assert!(idx.to_string().contains(idx.info().name));
}

#[test]
fn all_32_substrates_have_non_empty_metadata() {
  assert_eq!(SUBSTRATES.len(), usize::from(ATLAS_SIZE));
  for entry in SUBSTRATES {
    assert_ne!(entry.name, "");
    assert_ne!(entry.group, "");
  }
}

#[test]
fn compatibility_bitmasks_match_certified_matrix_counts_and_symmetry() {
  for (cond, expected_count) in [
    (Condition::Heat, 32_usize),
    (Condition::Acid, 54),
    (Condition::Base, 72),
    (Condition::Palladium, 8),
    (Condition::Auto, 166),
  ] {
    let mut count = 0_usize;
    for a in 0..ATLAS_SIZE {
      for b in 0..ATLAS_SIZE {
        let ia = AtlasIndex(a);
        let ib = AtlasIndex(b);
        assert_eq!(can_react(ia, ib, cond), can_react(ib, ia, cond));
        if can_react(ia, ib, cond) {
          count += 1;
        }
      }
    }
    assert_eq!(count, expected_count, "{cond:?}");
  }

  assert!(can_react(AtlasIndex(0), AtlasIndex(4), Condition::Heat));
  assert!(!can_react(AtlasIndex(0), AtlasIndex(4), Condition::Acid));
  assert!(can_react(AtlasIndex(0), AtlasIndex(4), Condition::Auto));
  assert!(!can_react(AtlasIndex(0), AtlasIndex(26), Condition::Auto));
  assert!(!can_react(AtlasIndex(8), AtlasIndex(18), Condition::Base));
  assert!(!can_react(AtlasIndex(22), AtlasIndex(20), Condition::Base));

  assert!(can_react_any(AtlasIndex(0), Condition::Heat));
  assert!(can_react_any(AtlasIndex(0), Condition::Auto));
  assert!(!can_react_any(AtlasIndex(0), Condition::Acid));
  assert!(!can_react_any(AtlasIndex(0), Condition::Base));
  assert!(!can_react_any(AtlasIndex(0), Condition::Palladium));
  assert!(can_react_any(AtlasIndex(26), Condition::Palladium));
  assert!(can_react_any(AtlasIndex(26), Condition::Auto));
  assert!(!can_react_any(AtlasIndex(26), Condition::Heat));
  assert!(!can_react_any(AtlasIndex(26), Condition::Acid));
  assert!(!can_react_any(AtlasIndex(26), Condition::Base));
}
