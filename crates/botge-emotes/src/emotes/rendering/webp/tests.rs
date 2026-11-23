//! Checks encoded frame delays and playback duration through the renderer.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use anyhow::{Context as _, Result};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use tokio::fs;

use super::super::{Asset, Image, RenderOptions, inspect, render};
use super::*;

// 4×8 yellow, cyan, and magenta frames with delays of 101, 89, and 59 ms.
pub(in crate::emotes::rendering) const ANIMATED_OVERLAY: &str = concat!(
  "UklGRrQAAABXRUJQVlA4WAoAAAACAAAAAwAABwAAQU5JTQYAAAD/////AwBBTk1GKAAAAAAA",
  "AAAAAAMAAAcAAGUAAAJWUDhMEAAAAC8DwAEAB9D//kf/AxHR/wBBTk1GKAAAAAAAAAAAAAMA",
  "AAcAAFkAAABWUDhMEAAAAC8DwAEAB9D/6H//AxHR/wBBTk1GKAAAAAAAAAAAAAMAAAcAADsA",
  "AABWUDhMEAAAAC8DwAEABxD973//AxHR/wA=",
);

/// Reads the encoded frame delays directly from the WebP container.
pub(in crate::emotes::rendering) fn delays(image: &Image) -> Vec<u32> {
  webp_chunks(&image.bytes)
    .filter(|(tag, _)| tag == b"ANMF")
    .filter_map(|(_, data)| {
      image
        .bytes
        .get(data.start + 12..data.end)
        .and_then(frame_delay)
    })
    .collect()
}

#[test]
fn rejects_incomplete_chunks_and_invalid_animation_header_lengths() {
  for bytes in [b"".as_slice(), b"RIFF", b"RIFF1234WEBP"] {
    assert!(webp_animation(bytes).is_none());
  }
  for length in [5_u32, 7, 100] {
    let mut bytes = b"RIFF1234WEBP".to_vec();
    bytes.extend_from_slice(b"ANIM");
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend_from_slice(&[0; 7]);
    assert!(webp_animation(&bytes).is_none());
  }
  assert_eq!(frame_delay(&[1, 2]), None);
}

#[test]
fn handles_zero_delays_and_rejects_truncated_or_unrepresentable_frame_timing() -> Result<()> {
  let mut bytes = STANDARD.decode(ANIMATED_OVERLAY)?;
  let original = webp_animation(&bytes).context("missing animation")?;
  let range = webp_chunks(&bytes)
    .find(|(tag, _)| tag == b"ANMF")
    .map(|(_, range)| range)
    .context("missing frame")?;
  let delay = bytes
    .get(range.start + 12..range.end)
    .and_then(frame_delay)
    .context("missing frame delay")?;
  bytes
    .get_mut(range.start + 12..range.start + 15)
    .context("missing delay bytes")?
    .fill(0);
  let adjusted = webp_animation(&bytes).context("zero delay was rejected")?;
  assert_eq!(
    adjusted.duration_ms,
    original.duration_ms - u64::from(delay) + 100
  );
  let size = 26_u32.to_le_bytes();
  let length = 14_u32.to_le_bytes();
  let mut truncated = [
    b"RIFF".as_slice(),
    &size,
    b"WEBP",
    b"ANMF",
    &length,
    &[0; 14],
  ]
  .concat();
  assert!(!normalize_webp_timing(&mut truncated, 100));
  let mut oversized = STANDARD.decode(ANIMATED_OVERLAY)?;
  assert!(!normalize_webp_timing(&mut oversized, 0x0400_0000));
  Ok(())
}

#[tokio::test]
async fn keeps_browser_playback_duration_when_frames_are_too_short() -> Result<()> {
  // Delays below 11 ms exercise frame-boundary adjustment. The 31 ms case also forces
  // the retry path because three frames cannot each receive at least 11 ms.
  for (input, expected) in [
    ([20, 10, 20], &[20, 11, 19][..]),
    ([4, 7, 20], &[11, 20][..]),
    ([20, 20, 10], &[20, 19, 11][..]),
  ] {
    let mut bytes = STANDARD.decode(ANIMATED_OVERLAY)?;
    let starts: Vec<_> = webp_chunks(&bytes)
      .filter(|(tag, _)| tag == b"ANMF")
      .map(|(_, range)| range.start + 12)
      .collect();
    for (start, delay) in starts.into_iter().zip(input) {
      bytes
        .get_mut(start..start + 3)
        .context("missing frame duration")?
        .copy_from_slice(&[delay, 0, 0]);
    }
    let dir = tempfile::tempdir()?;
    let path = dir.path().join("input.webp");
    fs::write(&path, &bytes).await?;
    let (info, _) = inspect(&path).await?;
    let animation = webp_animation(&bytes).context("missing fixture animation")?;
    let duration = animation.duration_ms;
    let output = render(
      dir.path(),
      &[Asset {
        info,
        duration_ms: Some(duration),
        path,
        overlay: false,
        webp_animation: Some(animation),
      }],
      RenderOptions {
        size_pixels: Some(24),
        stretch: false,
        border: None,
      },
    )
    .await?;
    assert_eq!(delays(&output), expected);
    let path = dir.path().join(output.filename);
    fs::write(&path, output.bytes).await?;
    assert_eq!(inspect(&path).await?.1, Some(duration));
  }
  Ok(())
}

#[test]
fn truncated_and_mutated_containers_preserve_timing_or_fail_without_panicking() -> Result<()> {
  let original = STANDARD.decode(ANIMATED_OVERLAY)?;
  let duration = webp_animation(&original)
    .context("missing fixture animation")?
    .duration_ms;

  for length in 0..original.len() {
    let mut truncated = original.get(..length).context("invalid prefix")?.to_vec();
    let before = truncated.clone();
    assert!(
      !normalize_webp_timing(&mut truncated, duration),
      "accepted prefix {length}"
    );
    assert_eq!(truncated, before, "truncated input was partially rewritten");
  }
  for index in 0..original.len() {
    for mask in [1, 0x80, 0xff] {
      let mut mutated = original.clone();
      *mutated.get_mut(index).context("missing mutation byte")? ^= mask;
      let before = mutated.clone();
      if normalize_webp_timing(&mut mutated, duration) {
        let metadata =
          webp_animation(&mutated).context("rewritten container lost frame metadata")?;
        assert_eq!(metadata.duration_ms, duration);
        assert!(
          delays(&Image {
            bytes: mutated,
            filename: "fixture.webp"
          })
          .iter()
          .all(|delay| u64::from(*delay) >= MIN_WEBP_FRAME_MS)
        );
      } else if index < 12 {
        assert_eq!(mutated, before, "invalid outer header caused writes");
      }
    }
  }
  let mut empty = b"RIFF\x04\0\0\0WEBP".to_vec();
  assert!(!normalize_webp_timing(&mut empty, 100));
  Ok(())
}
