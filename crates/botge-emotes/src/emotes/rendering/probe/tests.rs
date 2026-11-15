//! Rejects invalid media metadata before layout or encoding can use it.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
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
    std::assert_matches!(parse_probe(&serde_json::to_vec(&value)?), Err(_));
  }
  std::assert_matches!(parse_probe(b"invalid JSON"), Err(_));
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

#[tokio::test]
async fn rejects_unreadable_files_and_durations_that_exceed_the_millisecond_range() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let missing = inspect(&directory.path().join("missing.png"))
    .await
    .err()
    .context("missing file accepted")?;
  assert!(missing.to_string().contains("could not read the emote"));
  let bytes = serde_json::to_vec(&json!({"streams":[{"width":1,"height":1}], "packets":[
    {"pts_time":"18446744073709550", "duration_time":"1"}, {"pts_time":"0", "duration_time":"1"}
  ]}))?;
  std::assert_matches!(parse_probe(&bytes), Err(_));
  Ok(())
}
