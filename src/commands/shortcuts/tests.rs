//! Exercises shortcuts command behavior.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use super::*;

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
