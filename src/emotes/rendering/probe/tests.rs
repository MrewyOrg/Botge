//! Rejects invalid media metadata before layout or encoding can use it.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use serde_json::json;

use super::*;

#[test]
fn validates_dimensions_and_requires_usable_animation_timing() -> Result<()> {
  for (width, height) in [(0, 1), (1, 0), (4096, 4096)] {
    let bytes = serde_json::to_vec(&json!({
      "streams": [{"width": width, "height": height}], "packets": []
    }))?;
    let error = parse_probe(&bytes)
      .err()
      .context("invalid dimensions were accepted")?;
    assert!(error.to_string().contains("pixel limit"));
  }
  for value in [
    json!({"streams": [], "packets": []}),
    json!({"streams": [{"width": 2, "height": 3}], "packets": [{}, {}]}),
  ] {
    assert!(parse_probe(&serde_json::to_vec(&value)?).is_err());
  }
  assert!(parse_probe(b"invalid JSON").is_err());
  let bytes = serde_json::to_vec(&json!({
    "streams": [{"width": 2, "height": 3}], "packets": []
  }))?;
  let (dimensions, duration) = parse_probe(&bytes)?;
  assert_eq!(
    (dimensions.width, dimensions.height, dimensions.frames),
    (2, 3, 1)
  );
  assert_eq!(duration, None);
  Ok(())
}

#[test]
fn ignores_missing_invalid_and_non_finite_packet_timing() {
  for (pts, duration) in [
    (None, Some("0.1")),
    (Some("0"), None),
    (Some("invalid"), Some("0.1")),
    (Some("0"), Some("invalid")),
    (Some("NaN"), Some("0.1")),
    (Some("-1"), Some("0.1")),
  ] {
    let packet = Packet {
      pts_time: pts.map(str::to_owned),
      duration_time: duration.map(str::to_owned),
    };
    assert_eq!(packet.end(), None);
  }
}
