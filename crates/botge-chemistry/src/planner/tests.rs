#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use std::collections::BTreeMap;

use anyhow::{Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
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

fn valid_reacted() -> ReactResponse {
  ReactResponse::Reacted {
    reaction_id: "diels_alder".into(),
    reaction_name: "Diels-Alder".into(),
    condition_used: Condition::Heat,
    substrate_a_name: "1,3-butadiene".into(),
    substrate_b_name: "maleic anhydride".into(),
    product_smiles: "O=C1OC(=O)C2CC=CCC12".into(),
    product_formula: "C8H8O3".into(),
    product_mw: 152.15,
    inchi_key: "TESTKEY".into(),
    base_index: 2,
    overlay_index: 1,
    diagram_png_b64: Some(STANDARD.encode(b"\x89PNG\r\n\x1a\n1234")),
  }
}

#[test]
fn plan_excludes_reactants_and_validates_response() -> Result<()> {
  let emotes = [
    emote("b0", "Alpha", false),
    emote("b1", "Beta", false),
    emote("b2", "Gamma", false),
    emote("o0", "Fire", true),
    emote("o1", "Spark", true),
  ];
  let pools = Pools::new(&emotes)?;
  let [e0, e1, ..] = &emotes;
  let plan = Plan::new(pools.clone(), e0, e1, Condition::Heat, Diagram::Include);
  let req = plan.request();
  assert_eq!(req.exclude_base_indices, vec![0, 1]);
  assert!(req.include_diagram);

  let self_plan = Plan::new(pools.clone(), e0, e0, Condition::Heat, Diagram::Omit);
  assert_eq!(self_plan.request().exclude_base_indices, vec![0]);
  assert!(!self_plan.request().include_diagram);

  let outside_base = emote("missing", "Missing", false);
  let external_plan = Plan::new(
    pools,
    &outside_base,
    &outside_base,
    Condition::Auto,
    Diagram::Omit,
  );
  assert_eq!(
    external_plan.request().exclude_base_indices,
    Vec::<u32>::new()
  );

  let Outcome::Reacted(selection) = plan.resolve(valid_reacted())? else {
    bail!("expected Reacted outcome");
  };
  assert_eq!(selection.base().name, "Gamma");
  assert_eq!(selection.overlay().name, "Spark");
  assert_ne!(selection.diagram_png(), None);

  let mut no_diagram = valid_reacted();
  if let ReactResponse::Reacted {
    ref mut diagram_png_b64,
    ..
  } = no_diagram
  {
    *diagram_png_b64 = None;
  }
  let Outcome::Reacted(without_diagram) = self_plan.resolve(no_diagram)? else {
    bail!("expected Reacted outcome without diagram");
  };
  assert_eq!(without_diagram.diagram_png(), None);

  // Reject unexpected PNG when Diagram::Omit was requested.
  assert_eq!(self_plan.resolve(valid_reacted()), Err(ChemError::Invalid));
  Ok(())
}

#[test]
fn plan_rejects_every_malformed_reacted_field() -> Result<()> {
  let emotes = [
    emote("b0", "Alpha", false),
    emote("b1", "Beta", false),
    emote("b2", "Gamma", false),
    emote("o0", "Fire", true),
    emote("o1", "Spark", true),
  ];
  let pools = Pools::new(&emotes)?;
  let [e0, e1, ..] = &emotes;
  let plan = Plan::new(pools, e0, e1, Condition::Heat, Diagram::Include);

  let cases: [fn(&mut ReactResponse); 14] = [
    |r| {
      if let ReactResponse::Reacted { condition_used, .. } = r {
        *condition_used = Condition::Auto;
      }
    },
    |r| {
      if let ReactResponse::Reacted { reaction_id, .. } = r {
        *reaction_id = " ".into();
      }
    },
    |r| {
      if let ReactResponse::Reacted { reaction_name, .. } = r {
        reaction_name.clear();
      }
    },
    |r| {
      if let ReactResponse::Reacted {
        substrate_a_name, ..
      } = r
      {
        substrate_a_name.clear();
      }
    },
    |r| {
      if let ReactResponse::Reacted {
        substrate_b_name, ..
      } = r
      {
        substrate_b_name.clear();
      }
    },
    |r| {
      if let ReactResponse::Reacted { product_smiles, .. } = r {
        product_smiles.clear();
      }
    },
    |r| {
      if let ReactResponse::Reacted {
        product_formula, ..
      } = r
      {
        product_formula.clear();
      }
    },
    |r| {
      if let ReactResponse::Reacted { inchi_key, .. } = r {
        inchi_key.clear();
      }
    },
    |r| {
      if let ReactResponse::Reacted { product_mw, .. } = r {
        *product_mw = f64::NAN;
      }
    },
    |r| {
      if let ReactResponse::Reacted { product_mw, .. } = r {
        *product_mw = 0.0;
      }
    },
    |r| {
      if let ReactResponse::Reacted { base_index, .. } = r {
        *base_index = 0;
      }
    },
    |r| {
      if let ReactResponse::Reacted { base_index, .. } = r {
        *base_index = 99;
      }
    },
    |r| {
      if let ReactResponse::Reacted { overlay_index, .. } = r {
        *overlay_index = 99;
      }
    },
    |r| {
      if let ReactResponse::Reacted {
        diagram_png_b64, ..
      } = r
      {
        *diagram_png_b64 = None;
      }
    },
  ];

  for mutate in cases {
    let mut response = valid_reacted();
    mutate(&mut response);
    assert_eq!(plan.resolve(response), Err(ChemError::Invalid));
  }
  Ok(())
}

#[test]
fn plan_handles_no_reaction_and_rejects_malformed_fields() -> Result<()> {
  let emotes = [
    emote("b0", "Alpha", false),
    emote("b1", "Beta", false),
    emote("o0", "Fire", true),
    emote("o1", "Spark", true),
  ];
  let pools = Pools::new(&emotes)?;
  let [e0, e1, ..] = &emotes;
  let plan = Plan::new(pools, e0, e1, Condition::Acid, Diagram::Omit);
  assert_eq!(plan.request().exclude_base_indices, Vec::<u32>::new());

  let nr = plan.resolve(ReactResponse::NoReaction {
    substrate_a_name: "1,3-butadiene".into(),
    substrate_a_group: "conjugated diene".into(),
    substrate_b_name: "maleic anhydride".into(),
    substrate_b_group: "cyclic dienophile".into(),
    reason: "Incompatible under acid.".into(),
    hint_condition: Some(Condition::Heat),
    hint_reaction: Some("Diels-Alder".into()),
  });
  assert!(matches!(nr, Ok(Outcome::NoReaction(_))));

  for bad in [
    ReactResponse::NoReaction {
      substrate_a_name: " ".into(),
      substrate_a_group: "g".into(),
      substrate_b_name: "b".into(),
      substrate_b_group: "g".into(),
      reason: "r".into(),
      hint_condition: None,
      hint_reaction: None,
    },
    ReactResponse::NoReaction {
      substrate_a_name: "a".into(),
      substrate_a_group: "g".into(),
      substrate_b_name: String::new(),
      substrate_b_group: "g".into(),
      reason: "r".into(),
      hint_condition: None,
      hint_reaction: None,
    },
    ReactResponse::NoReaction {
      substrate_a_name: "a".into(),
      substrate_a_group: "g".into(),
      substrate_b_name: "b".into(),
      substrate_b_group: "g".into(),
      reason: " ".into(),
      hint_condition: None,
      hint_reaction: None,
    },
    ReactResponse::NoReaction {
      substrate_a_name: "a".into(),
      substrate_a_group: "g".into(),
      substrate_b_name: "b".into(),
      substrate_b_group: "g".into(),
      reason: "r".into(),
      hint_condition: Some(Condition::Auto),
      hint_reaction: None,
    },
  ] {
    assert_eq!(plan.resolve(bad), Err(ChemError::Invalid));
  }
  Ok(())
}
