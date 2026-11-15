//! Probes local images under a deadline and rejects invalid dimensions and animation timing.

use std::{path::Path, process::Stdio, time::Duration};

use anyhow::{Context as _, Result};
use serde::Deserialize;
use tokio::process::Command;

use super::{Dimensions, IMAGE_FORMATS};

/// The optional timestamp and duration reported for one input packet.
#[derive(Deserialize)]
struct Packet {
  pts_time: Option<String>,
  duration_time: Option<String>,
}

impl Packet {
  /// Converts usable packet timing into the playback time at the packet's end.
  fn end(&self) -> Option<Duration> {
    let pts = self.pts_time.as_deref()?.parse::<f64>().ok()?;
    let duration = self.duration_time.as_deref()?.parse::<f64>().ok()?;
    Duration::try_from_secs_f64(pts + duration).ok()
  }
}

/// The fields requested from `FFprobe` to validate an input and determine its duration.
#[derive(Deserialize)]
struct Probe {
  streams: Vec<Dimensions>,
  packets: Vec<Packet>,
}

/// Validates dimensions and reads playback timing from a local image.
///
/// Uses the first video stream. Zero or one packet is treated as static. For multiple packets,
/// the duration is the latest usable packet end rounded up to a millisecond. `FFprobe` has a
/// separate five-second deadline for each input and is terminated if that deadline expires.
///
/// # Errors
///
/// Returns an error if `FFprobe` fails or exceeds five seconds, the response is malformed,
/// dimensions exceed the pixel limit, or an animated input lacks usable timing.
pub(super) async fn inspect(path: &Path) -> Result<(Dimensions, Option<u64>)> {
  let mut command = Command::new("ffprobe");
  command.kill_on_drop(true).stdin(Stdio::null());
  let result = tokio::time::timeout(
    Duration::from_secs(5),
    command
      .args([
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        IMAGE_FORMATS,
        "-max_pixels",
        "4194304",
        "-threads",
        "1",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:packet=pts_time,duration_time",
        "-of",
        "json",
      ])
      .arg(path)
      .output(),
  )
  .await
  .context("FFprobe exceeded its 5-second time budget")??;
  anyhow::ensure!(
    result.status.success(),
    "FFprobe could not read the emote: {}",
    String::from_utf8_lossy(&result.stderr)
  );
  parse_probe(&result.stdout)
}

/// Validates the probe response before dimensions or packet timing reach the renderer.
///
/// # Errors
///
/// Returns an error for malformed JSON, absent streams, invalid or excessive dimensions,
/// missing animation timing, or a duration that cannot fit the millisecond representation.
fn parse_probe(bytes: &[u8]) -> Result<(Dimensions, Option<u64>)> {
  let probe: Probe = serde_json::from_slice(bytes)?;
  let mut dimensions = probe
    .streams
    .into_iter()
    .next()
    .context("missing emote dimensions")?;
  anyhow::ensure!(
    dimensions.width > 0
      && dimensions.height > 0
      && dimensions.width.saturating_mul(dimensions.height) <= 4_194_304,
    "emote dimensions exceed the pixel limit"
  );
  dimensions.frames = probe.packets.len().max(1);
  let duration_ms = if probe.packets.len() > 1 {
    let duration = probe
      .packets
      .iter()
      .filter_map(Packet::end)
      .max()
      .filter(|duration| !duration.is_zero())
      .context("missing emote frame timing")?;
    Some(u64::try_from(duration.as_micros().div_ceil(1000))?)
  } else {
    None
  };
  Ok((dimensions, duration_ms))
}

#[cfg(test)]
mod tests;
