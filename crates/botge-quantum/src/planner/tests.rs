//! Checks the request sizes and that only samples consistent with the budget select emotes.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use super::*;

fn emote(name: &str, overlaying: bool) -> Emote {
  Emote {
    id: name.into(),
    name: name.into(),
    source: botge_domain::emotes::Source::SevenTv,
    image: String::new(),
    sizes: std::collections::BTreeMap::default(),
    animated: false,
    overlaying,
    tags: Vec::new(),
    added: false,
  }
}

fn sample(qubits: u32, base_index: u32, overlay_index: u32) -> serde_json::Result<Sample> {
  serde_json::from_value(serde_json::json!({
    "mode": "entangle",
    "qubits": qubits,
    "base_index": base_index,
    "overlay_index": overlay_index,
  }))
}

#[test]
fn requests_the_capped_pool_sizes_and_steps() -> anyhow::Result<()> {
  let catalog = [
    emote("a", false),
    emote("b", false),
    emote("c", false),
    emote("x", true),
    emote("y", true),
  ];
  let steps = Steps::try_from(6).unwrap_or_default();
  let plan = Plan::new(Pools::new(&catalog)?, steps);
  assert_eq!(
    plan.request(),
    EntangleRequest {
      base_pool_size: 3,
      overlay_pool_size: 2,
      steps,
    }
  );
  Ok(())
}

#[test]
fn resolves_in_pool_indices_and_rejects_inconsistent_samples() -> anyhow::Result<()> {
  let catalog = [
    emote("a", false),
    emote("b", false),
    emote("c", false),
    emote("x", true),
    emote("y", true),
  ];
  let plan = Plan::new(Pools::new(&catalog)?, Steps::default());
  let selection = plan.resolve(&sample(3, 2, 1)?);
  assert_eq!(
    selection.map(|selection| (
      selection.base().name.as_str(),
      selection.overlay().name.as_str()
    )),
    Ok(("c", "y"))
  );
  assert_eq!(selection.map(|selection| selection.qubits), Ok(3));
  for (qubits, base, overlay) in [(4, 0, 0), (3, 3, 0), (3, 0, 2), (3, u32::MAX, 0)] {
    assert_eq!(
      plan.resolve(&sample(qubits, base, overlay)?),
      Err(QuantumError::Invalid)
    );
  }
  Ok(())
}
