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
fn webp_chunks(bytes: &[u8]) -> impl Iterator<Item = ([u8; 4], Range<usize>)> {
  let mut remaining = bytes.get(12..).unwrap_or_default();
  std::iter::from_fn(move || {
    let (header, rest) = remaining.split_first_chunk::<8>()?;
    let &[tag0, tag1, tag2, tag3, len0, len1, len2, len3] = header;
    let tag = [tag0, tag1, tag2, tag3];
    let length = u32::from_le_bytes([len0, len1, len2, len3]) as usize;
    let (data, tail) = rest.split_at_checked(length)?;
    let start = bytes.len() - rest.len();
    remaining = tail.get(length % 2..)?;
    Some((tag, start..start + data.len()))
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
    if &tag == b"ANIM" {
      loops = Some(u16::from_le_bytes(
        *bytes.get(data.start + 4..data.end)?.as_array()?,
      ));
    } else if &tag == b"ANMF" {
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
  if !bytes.starts_with(b"RIFF") || bytes.get(8..12) != Some(b"WEBP") {
    return false;
  }
  let declared = bytes
    .get(4..8)
    .and_then(|size| size.try_into().ok())
    .map(u32::from_le_bytes)
    .and_then(|size| usize::try_from(size).ok())
    .and_then(|size| size.checked_add(8));
  if declared != Some(bytes.len()) {
    return false;
  }
  let mut frames = Vec::new();
  let mut has_animation = false;
  for (tag, data) in webp_chunks(bytes) {
    if &tag == b"ANIM" {
      if data.len() != 6 {
        return false;
      }
      has_animation = true;
    } else if &tag == b"ANMF" {
      let start = data.start + 12;
      let Some(delay) = bytes.get(start..data.end).and_then(frame_delay) else {
        return false;
      };
      frames.push((start, delay));
    }
  }
  let count = frames.len() as u64;
  if !has_animation || count == 0 || duration_ms < count * MIN_WEBP_FRAME_MS {
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
