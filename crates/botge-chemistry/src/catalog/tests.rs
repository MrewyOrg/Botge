#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use std::collections::BTreeMap;

use botge_domain::emotes::Source;

use super::*;

fn emote(id: &str, name: &str, overlaying: bool) -> Emote {
  Emote {
    id: id.into(),
    name: name.into(),
    source: Source::SevenTv,
    image: format!("https://cdn.7tv.app/emote/{id}/1x.webp"),
    sizes: BTreeMap::new(),
    animated: false,
    overlaying,
    tags: Vec::new(),
    added: false,
  }
}

#[test]
fn pools_sort_deterministically_dedup_and_locate_base_indices() -> anyhow::Result<()> {
  let emotes = [
    emote("id-b", "Beta", false),
    emote("id-blank", " ` ", false),
    emote("id-a", "alpha", false),
    emote("id-a", "shadowed", false),
    emote("ov-2", "Zeta", true),
    emote("ov-1", "aura", true),
  ];
  let pools = Pools::new(&emotes)?;
  assert_eq!(pools.base().len(), 2);
  assert_eq!(
    pools
      .base()
      .iter()
      .map(|e| e.name.as_str())
      .collect::<Vec<_>>(),
    ["alpha", "Beta"]
  );
  assert_eq!(
    pools.overlay().first().map(|e| e.name.as_str()),
    Some("aura")
  );
  let [first, _, third, _, fifth, _] = &emotes;
  assert_eq!(pools.base_index_of(third), Some(0));
  assert_eq!(pools.base_index_of(fifth), None);
  assert_eq!(pools.base_index_of(first), Some(1));
  Ok(())
}
