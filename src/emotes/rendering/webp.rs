// cspell:words ANMF

//! Reads WebP animation metadata and preserves browser-compatible frame timing.

use std::ops::Range;

use super::MIN_WEBP_FRAME_MS;

/// The loop count and frame duration read directly from an animated WebP container.
pub(super) struct WebpAnimation {
  /// A loop count of zero means repeat indefinitely.
  pub(super) loops: u16,
  pub(super) duration_ms: u64,
}

/// Walks RIFF chunk headers and returns the bounds of each payload without copying it.
fn webp_chunks(bytes: &[u8]) -> impl Iterator<Item = (&[u8], Range<usize>)> {
  let mut start = 12usize;
  std::iter::from_fn(move || {
    let header_end = start.checked_add(8)?;
    let header = bytes.get(start..header_end)?;
    let (tag, length) = header.split_first_chunk::<4>()?;
    let length = u32::from_le_bytes(*length.as_array()?) as usize;
    let end = header_end.checked_add(length)?;
    bytes.get(header_end..end)?;
    start = end.checked_add(length % 2)?;
    Some((tag.as_slice(), header_end..end))
  })
}

/// Decodes the 24-bit little-endian delay field of a WebP animation frame.
fn frame_delay(bytes: &[u8]) -> Option<u32> {
  let &[a, b, c] = bytes.first_chunk()?;
  Some(u32::from_le_bytes([a, b, c, 0]))
}

/// Reads the container's loop count and sums its per-frame delays.
///
/// A zero-delay frame contributes 100 ms. These values supplement `FFprobe` for animated WebP,
/// where the renderer needs the source's loop count and playback duration.
pub(super) fn webp_animation(bytes: &[u8]) -> Option<WebpAnimation> {
  let mut loops = None;
  let mut duration_ms = 0;
  for (tag, data) in webp_chunks(bytes) {
    if tag == b"ANIM" {
      loops = Some(u16::from_le_bytes(
        *bytes.get(data.start + 4..data.end)?.as_array()?,
      ));
    } else if tag == b"ANMF" {
      let delay = frame_delay(bytes.get(data.start + 12..data.end)?)?;
      duration_ms += u64::from(if delay == 0 { 100 } else { delay });
    }
  }
  Some(WebpAnimation {
    loops: loops?,
    duration_ms,
  })
}

/// Moves frame boundaries to avoid Chromium treating delays of 10 ms or less as 100 ms.
///
/// Intermediate boundaries stay as close to the encoded ones as the minimum frame delay
/// permits. The final boundary is fixed at `duration_ms` to preserve the total playback time.
///
/// A `false` result means the caller must discard or overwrite the buffer. An error late in
/// the rewrite can leave earlier frame delays changed.
pub(super) fn normalize_webp_timing(bytes: &mut [u8], duration_ms: u64) -> bool {
  let mut frames = Vec::new();
  for (tag, data) in webp_chunks(bytes) {
    if tag == b"ANMF" {
      let start = data.start + 12;
      let Some(delay) = bytes.get(start..data.end).and_then(frame_delay) else {
        return false;
      };
      frames.push((start, delay));
    }
  }
  let count = frames.len() as u64;
  if duration_ms < count * MIN_WEBP_FRAME_MS {
    return false;
  }
  let mut encoded_end = 0;
  let mut output_start = 0;
  for (index, (offset, delay)) in frames.into_iter().enumerate() {
    encoded_end += u64::from(delay);
    let remaining = count - index as u64 - 1;
    let output_end = if remaining == 0 {
      duration_ms
    } else {
      encoded_end.clamp(
        output_start + MIN_WEBP_FRAME_MS,
        duration_ms - remaining * MIN_WEBP_FRAME_MS,
      )
    };
    let adjusted = output_end - output_start;
    if adjusted > 0x00ff_ffff {
      return false;
    }
    let Some(target) = bytes.get_mut(offset..offset + 3) else {
      return false;
    };
    let [a, b, c, ..] = adjusted.to_le_bytes();
    target.copy_from_slice(&[a, b, c]);
    output_start = output_end;
  }
  true
}

#[cfg(test)]
pub(super) mod tests;
