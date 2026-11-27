#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use std::collections::BTreeMap;

use botge_domain::emotes::{Emote, Source};

use super::*;
use crate::Condition;

fn emote(id: &str, name: &str) -> Emote {
  Emote {
    id: id.into(),
    name: name.into(),
    source: Source::SevenTv,
    image: format!("https://cdn.7tv.app/emote/{id}/1x.webp"),
    sizes: BTreeMap::new(),
    animated: false,
    overlaying: false,
    tags: Vec::new(),
    added: false,
  }
}

#[test]
fn captions_strip_backticks_and_format_hints() {
  let ea = emote("1", "KEK`W");
  let eb = emote("2", "Pepega");
  let base = emote("3", "PogU");
  let ov = emote("4", "Fire");
  let sel = ReactionSelection {
    emote_a: &ea,
    emote_b: &eb,
    base: &base,
    overlay: &ov,
    reaction_name: "Diels-Alder".into(),
    condition_used: Condition::Heat,
    substrate_a_name: "1,3-butadiene".into(),
    substrate_b_name: "maleic anhydride".into(),
    product_formula: "C8H8O3".into(),
    product_mw: 152.15,
    diagram_png: None,
  };
  assert_eq!(
    sel.to_string(),
    "`KEKW` (1,3-butadiene) + `Pepega` (maleic anhydride) —[heat · Diels-Alder]→ `PogU` + `Fire` (C8H8O3, MW 152.15)"
  );

  let report = NoReactionReport {
    emote_a: &ea,
    emote_b: &eb,
    substrate_a_name: "1,3-butadiene".into(),
    substrate_a_group: "conjugated diene".into(),
    substrate_b_name: "maleic anhydride".into(),
    substrate_b_group: "cyclic dienophile".into(),
    reason: "Needs heat.".into(),
    hint_condition: Some(Condition::Heat),
    hint_reaction: Some("Diels-Alder".into()),
  };
  let rendered = report.to_string();
  assert!(rendered.contains("`KEKW`"));
  assert!(rendered.contains("Hint: compatible under `heat` (Diels-Alder)."));

  let no_hint = NoReactionReport {
    hint_condition: None,
    hint_reaction: None,
    ..report
  };
  let no_hint_rendered = no_hint.to_string();
  assert!(no_hint_rendered.contains("`KEKW`"));
  assert!(!no_hint_rendered.contains("Hint:"));
}
