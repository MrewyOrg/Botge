//! Checks that captions name the circuit and both emotes without breaking inline code.

#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use botge_domain::emotes::{Emote, Source};

use crate::{Selection, Steps};

fn emote(name: &str) -> Emote {
  Emote {
    id: "1".into(),
    name: name.into(),
    source: Source::SevenTv,
    image: String::new(),
    sizes: std::collections::BTreeMap::default(),
    animated: false,
    overlaying: false,
    tags: Vec::new(),
    added: false,
  }
}

#[test]
fn names_the_circuit_and_both_emotes() {
  let (base, overlay) = (emote("Wave"), emote("Hat"));
  let selection = Selection {
    base: &base,
    overlay: &overlay,
    qubits: 16,
    steps: Steps::default(),
  };
  assert_eq!(
    selection.to_string(),
    "Drew `Wave` with overlay `Hat` from one shot of a simulated 16-qubit Ising-Rx circuit \
     (3 steps)."
  );
  let one = Selection {
    steps: Steps::try_from(1).unwrap_or_default(),
    qubits: 2,
    ..selection
  };
  assert!(
    one
      .to_string()
      .ends_with("2-qubit Ising-Rx circuit (1 step)."),
    "{one}"
  );
}

#[test]
fn strips_backticks_and_truncates_long_names() {
  let (base, overlay) = (emote("`a`b`"), emote(&"x".repeat(150)));
  let caption = Selection {
    base: &base,
    overlay: &overlay,
    qubits: 3,
    steps: Steps::default(),
  }
  .to_string();
  assert!(caption.starts_with("Drew `ab` with overlay `"), "{caption}");
  assert!(
    caption.contains(&format!("`{}`", "x".repeat(100))),
    "{caption}"
  );
  assert!(!caption.contains(&"x".repeat(101)), "{caption}");
}
