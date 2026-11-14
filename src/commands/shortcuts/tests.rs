//! Exercises shortcuts command behavior.

#![expect(
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use super::*;

#[bench]
fn unicode_shortcut(b: &mut test::Bencher) {
  let entries =
    ["Wave", "wave", "SeaWave", "é猫", "猫"].map(|name| crate::emotes::tests::example(name, name));
  b.iter(|| std::hint::black_box(shortcuts(std::hint::black_box(&entries), "é猫")));
}

#[test]
fn shortcuts_preserve_exact_matches_aliases_and_unicode_boundaries() {
  let entries = ["Wave", "wave", "Waves", "SeaWave", "é猫", "猫"]
    .map(|name| crate::emotes::tests::example(name, name));
  assert_eq!(shortcuts(&entries, "Wave"), "`Wave` → `Wave`");
  assert_eq!(shortcuts(&entries, "Waves"), "`Waves` → `es`");
  assert_eq!(shortcuts(&entries, "é猫"), "`é猫` → `é`");
  assert_eq!(shortcuts(&entries, "猫"), "`猫` → `猫`");
  let spaced = ["A Wave", "A", "Wave"].map(|name| crate::emotes::tests::example(name, name));
  assert_eq!(shortcuts(&spaced, "A Wave"), "`A Wave` → `A W`");
}

#[test]
fn shortcuts_resolve_large_overlapping_catalogs() {
  let target = "a".repeat(80);
  let mut overlap = vec![crate::emotes::tests::example(&target, "target")];
  for index in 0..80 {
    let mut name = target.clone();
    name.replace_range(index..=index, "b");
    overlap.push(crate::emotes::tests::example(&name, &index.to_string()));
  }
  assert_eq!(
    shortcuts(&overlap, &target),
    format!("`{target}` → `{target}`")
  );
}
