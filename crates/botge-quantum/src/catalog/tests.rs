//! Checks pool partitioning, deterministic ordering, deduplication and the piecewise slice.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use super::*;

fn emote(name: &str, id: &str, overlaying: bool) -> Emote {
  Emote {
    id: id.into(),
    name: name.into(),
    source: botge_domain::emotes::Source::SevenTv,
    image: format!("https://cdn.7tv.app/emote/{id}/2x.png"),
    sizes: std::collections::BTreeMap::default(),
    animated: false,
    overlaying,
    tags: Vec::new(),
    added: false,
  }
}

fn names<'a>(pool: &[&'a Emote]) -> Vec<&'a str> {
  pool.iter().map(|emote| emote.name.as_str()).collect()
}

#[test]
fn sorts_each_pool_case_insensitively_then_by_id() -> Result<(), BudgetError> {
  let catalog = [
    emote("wave", "b", false),
    emote("Hat", "h", true),
    emote("Wave", "a", false),
    emote("apple", "z", false),
    emote("glasses", "g", true),
  ];
  let pools = Pools::new(&catalog)?;
  assert_eq!(names(pools.base()), ["apple", "Wave", "wave"]);
  assert_eq!(names(pools.overlay()), ["glasses", "Hat"]);
  let mut reversed = catalog.clone();
  reversed.reverse();
  let again = Pools::new(&reversed)?;
  assert_eq!(pools.base(), again.base());
  assert_eq!(pools.overlay(), again.overlay());
  assert_eq!(pools.budget(), Budget::new(3, 2)?);
  Ok(())
}

#[test]
fn skips_blank_names_and_repeated_ids_before_counting() {
  let catalog = [
    emote("Alias", "1", false),
    emote("Original", "1", false),
    emote(" ", "2", false),
    emote("` `", "5", false),
    emote("Hat", "3", true),
    emote("Glasses", "4", true),
  ];
  assert_eq!(
    Pools::new(&catalog).map(|pools| names(pools.base())),
    Err(BudgetError::BasePoolTooSmall { count: 1 })
  );
  let catalog = [
    emote("Wave", "1", false),
    emote("Smile", "2", false),
    emote("Hat", "3", true),
    emote("Hat again", "3", true),
  ];
  assert_eq!(
    Pools::new(&catalog).map(|pools| names(pools.overlay())),
    Err(BudgetError::OverlayPoolTooSmall { count: 1 })
  );
  let catalog = [
    emote("Alias", "1", false),
    emote("Original", "1", false),
    emote("Smile", "2", false),
    emote("Hat", "3", true),
    emote("Glasses", "4", true),
  ];
  assert_eq!(
    Pools::new(&catalog).map(|pools| names(pools.base())),
    Ok(vec!["Alias", "Smile"])
  );
}

#[test]
fn slices_the_sorted_prefix_at_each_cap_branch() -> Result<(), BudgetError> {
  let (narrow, wide) = if cfg!(miri) { (20, 24) } else { (512, 1100) };
  let pool = |base: usize, overlay: usize| -> Vec<Emote> {
    (0..base)
      .map(|index| emote(&format!("b{index:05}"), &format!("b{index}"), false))
      .chain((0..overlay).map(|index| emote(&format!("o{index:05}"), &format!("o{index}"), true)))
      .rev()
      .collect()
  };
  for (base, overlay) in [(narrow, 200), (wide, 200)] {
    let catalog = pool(base, overlay);
    let pools = Pools::new(&catalog)?;
    let budget = Budget::new(base, overlay)?;
    let expected = |prefix: char, count: u32| -> Vec<String> {
      (0..count)
        .map(|index| format!("{prefix}{index:05}"))
        .collect()
    };
    assert_eq!(pools.budget(), budget);
    assert_eq!(names(pools.base()), expected('b', budget.base_pool()));
    assert_eq!(names(pools.overlay()), expected('o', budget.overlay_pool()));
  }
  Ok(())
}
