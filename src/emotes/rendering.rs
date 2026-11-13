// cspell:words ANMF apng bgra hstack isnan nostdin rsplit setsar settb

//! Downloads bounded image inputs and renders attachments with FFmpeg.
//!
//! [`Layer`] identifies a validated remote image and its place in a composition. The
//! renderer stages inputs in a temporary directory, probes them, and invokes FFmpeg with
//! local-only protocols. [`original`] bypasses conversion when the caller needs the source
//! bytes, and [`compose`] handles resizing, borders, and multiple layers.

use std::{
  ops::Range,
  path::{Path, PathBuf},
  process::Stdio,
  time::Duration,
};

use anyhow::{Context as _, Result};
use futures_util::future::join_all;
use reqwest::{Client, Url};
use serde::Deserialize;
use tokio::{fs, process::Command};

use super::{Emote, Source, cdn_url, providers::bounded_bytes};

const MAX_INPUTS: usize = 32;
const MAX_ASSET: usize = 2 * 1024 * 1024;
const MAX_ATTACHMENT: usize = 8 * 1024 * 1024;
const MIN_WEBP_FRAME_MS: u64 = 11;
const IMAGE_FORMATS: &str = "png_pipe,jpeg_pipe,gif,webp_pipe,webp_anim,apng";

/// Attachment bytes and the filename Discord uses to identify their format.
pub(crate) struct Image {
  pub(crate) bytes: Vec<u8>,
  pub(crate) filename: &'static str,
}

/// One validated media input in composition order.
///
/// Constructors apply the CDN rules before a layer reaches the downloader. A non-overlay
/// input begins a column, while subsequent overlay inputs are drawn in that column in order.
#[derive(Clone)]
pub(crate) struct Layer {
  pub(crate) url: Url,
  /// Place this input over the current column when a preceding layer exists.
  pub(crate) overlay: bool,
}

impl Layer {
  /// Accepts a catalog entry whose image URL passes the rules for its declared provider.
  pub(crate) fn emote(emote: &Emote) -> Option<Self> {
    Some(Self {
      url: cdn_url(&emote.image, emote.source)?,
      overlay: emote.overlaying,
    })
  }

  /// Accepts custom emoji markup and HTTPS links to Discord emoji or attachment paths.
  ///
  /// Animated markup selects the GIF asset. The returned layer starts its own column because
  /// Discord media inputs carry no provider overlay flag.
  pub(crate) fn discord(input: &str) -> Option<Self> {
    let url = if let Some(id) = input
      .strip_prefix("<a:")
      .or_else(|| input.strip_prefix("<:"))
      .and_then(|input| input.strip_suffix('>'))
      .and_then(|input| input.rsplit_once(':'))
      .and_then(|(_, id)| crate::settings::discord_id(id))
    {
      let ext = if input.starts_with("<a:") {
        "gif"
      } else {
        "png"
      };
      Url::parse(&format!("https://cdn.discordapp.com/emojis/{id}.{ext}")).ok()?
    } else {
      Url::parse(input).ok()?
    };
    if url.scheme() != "https"
      || url.port().is_some()
      || !url.username().is_empty()
      || url.password().is_some()
      || url.fragment().is_some()
      || !matches!(
        url.host_str(),
        Some("cdn.discordapp.com" | "media.discordapp.net")
      )
      || !(url.path().starts_with("/attachments/") || url.path().starts_with("/emojis/"))
    {
      return None;
    }
    Some(Self {
      url,
      overlay: false,
    })
  }
}

/// Routes known provider URLs through nginx when a cache is configured.
fn cache_url(url: &Url, cache: Option<&Url>) -> Url {
  for source in [
    Source::SevenTv,
    Source::BetterTtv,
    Source::Ffz,
    Source::Twitch,
  ] {
    let (host, path) = source.cdn();
    if url.host_str() == Some(host)
      && let Some(cache) = cache
    {
      let mut cache = cache.clone();
      cache.set_path(&format!("/{path}{}", url.path()));
      cache.set_query(url.query());
      return cache;
    }
  }
  url.clone()
}

/// Recognizes the supported formats from their signatures rather than HTTP metadata.
fn image_type(bytes: &[u8]) -> Option<&'static str> {
  if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
    Some("png")
  } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
    Some("gif")
  } else if bytes.starts_with(b"\xff\xd8\xff") {
    Some("jpg")
  } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
    Some("webp")
  } else {
    None
  }
}

/// Downloads a layer within the input byte budget and identifies its image format.
async fn fetch(
  http: &Client,
  layer: &Layer,
  cache: Option<&Url>,
) -> Result<(Vec<u8>, &'static str)> {
  let bytes = bounded_bytes(
    http.get(cache_url(&layer.url, cache)).send().await?,
    MAX_ASSET,
  )
  .await?;
  let ext = image_type(&bytes).context("unrecognized emote image format")?;
  Ok((bytes, ext))
}

/// Returns the original bytes with an extension chosen from their image signature.
///
/// # Errors
///
/// Returns an error when the download fails, exceeds the per-input byte limit, or lacks
/// a recognized image signature. This path neither probes nor re-encodes the file.
pub(crate) async fn original(http: &Client, layer: &Layer, cache: Option<&Url>) -> Result<Image> {
  let (bytes, extension) = fetch(http, layer, cache).await?;
  let filename = match extension {
    "gif" => "emote.gif",
    "jpg" => "emote.jpg",
    "webp" => "emote.webp",
    _ => "emote.png",
  };
  Ok(Image { bytes, filename })
}

/// Output choices shared by slash commands and message shortcuts.
pub(crate) struct RenderOptions {
  /// Requested size in pixels, clamped to 24–256. A single input is fit within that square.
  /// A composition uses the value as its target column height before applying the width budget.
  /// With no value, a single input keeps its dimensions and a composition starts at 64 pixels.
  pub(crate) size: Option<u16>,
  /// Scale overlays to the full column rather than preserving their aspect ratio.
  pub(crate) stretch: bool,
  /// Optional border in packed RGB form (`0xRRGGBB`), drawn four pixels wide around the canvas.
  pub(crate) border: Option<u32>,
}

/// Downloads bounded batches, probes each input, and renders from local temporary files.
///
/// Inputs are kept in the caller's order even though downloads within each batch run
/// concurrently. The temporary directory owns the staged assets until the output bytes have
/// been read. An animated composition uses the longest input's playback cycle.
///
/// # Errors
///
/// Fails on an empty or oversized layer list, failed or oversized downloads, invalid image
/// dimensions, missing animation timing, a subprocess failure or deadline, or output above
/// the attachment budget. Any failed input stops the composition.
pub(crate) async fn compose(
  http: &Client,
  layers: &[Layer],
  cache: Option<&Url>,
  options: RenderOptions,
) -> Result<Image> {
  anyhow::ensure!(
    !layers.is_empty() && layers.len() <= MAX_INPUTS,
    "use 1–32 emotes or Discord images"
  );
  let temp = tempfile::tempdir()?;
  let mut total = 0;
  let mut assets = Vec::with_capacity(layers.len());
  for batch in layers.chunks(4) {
    let downloads = batch.iter().map(|layer| fetch(http, layer, cache));
    for (layer, download) in batch.iter().zip(join_all(downloads).await) {
      let (bytes, ext) = download?;
      total += bytes.len();
      anyhow::ensure!(
        total <= 20 * 1024 * 1024,
        "composition inputs exceed 20 MiB"
      );
      let file = temp.path().join(format!("{}.{}", assets.len(), ext));
      let webp_animation = if ext == "webp" {
        webp_animation(&bytes)
      } else {
        None
      };
      fs::write(&file, bytes).await?;
      let (info, duration_ms) = inspect(&file).await?;
      // Use the source WebP frame delays when available, while preserving static inputs.
      let duration_ms = duration_ms.map(|duration| {
        webp_animation
          .as_ref()
          .map_or(duration, |webp| webp.duration_ms)
      });
      assets.push(Asset {
        info,
        duration_ms,
        path: file,
        overlay: layer.overlay,
        webp_animation,
      });
    }
  }
  render(temp.path(), &assets, options).await
}

/// The width and height returned by FFprobe for the first video stream.
#[derive(Deserialize)]
struct Dimensions {
  width: u32,
  height: u32,
}

impl Dimensions {
  /// Fits within the height and width bounds while preserving aspect ratio.
  fn fit(&self, height: u32, max_width: u32) -> (u32, u32) {
    let width = (self.width * height + self.height / 2) / self.height;
    if width > max_width {
      (
        max_width,
        ((self.height * max_width + self.width / 2) / self.width).max(1),
      )
    } else {
      (width.max(1), height)
    }
  }
}

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

/// The fields requested from FFprobe to validate an input and determine its duration.
#[derive(Deserialize)]
struct Probe {
  streams: Vec<Dimensions>,
  packets: Vec<Packet>,
}

/// Probed media staged for one render. The composition owns the temporary directory.
struct Asset {
  info: Dimensions,
  /// The duration of one playback cycle, or `None` for a static image.
  duration_ms: Option<u64>,
  path: PathBuf,
  overlay: bool,
  webp_animation: Option<WebpAnimation>,
}

/// Validates dimensions and reads playback timing from a local image.
///
/// Uses the first video stream. Zero or one packet is treated as static. For multiple packets,
/// the duration is the latest usable packet end rounded up to a millisecond. FFprobe has a
/// separate five-second deadline for each input and is terminated if that deadline expires.
async fn inspect(path: &Path) -> Result<(Dimensions, Option<u64>)> {
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
  let probe: Probe = serde_json::from_slice(&result.stdout)?;
  let dimensions = probe
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

/// The loop count and frame duration read directly from an animated WebP container.
struct WebpAnimation {
  /// A loop count of zero means repeat indefinitely.
  loops: u16,
  duration_ms: u64,
}

/// Walks RIFF chunk headers and returns the bounds of each payload without copying it.
fn webp_chunks(bytes: &[u8]) -> impl Iterator<Item = (&[u8], Range<usize>)> {
  let mut start = 12usize;
  std::iter::from_fn(move || {
    let header_end = start.checked_add(8)?;
    let header = bytes.get(start..header_end)?;
    let tag = header.get(..4)?;
    let length = u32::from_le_bytes(header.get(4..8)?.try_into().ok()?) as usize;
    let end = header_end.checked_add(length)?;
    bytes.get(header_end..end)?;
    start = end.checked_add(length % 2)?;
    Some((tag, header_end..end))
  })
}

/// Decodes the 24-bit little-endian delay field of a WebP animation frame.
fn frame_delay(bytes: &[u8]) -> Option<u32> {
  let [a, b, c] = bytes.get(..3)?.try_into().ok()?;
  Some(u32::from_le_bytes([a, b, c, 0]))
}

/// Reads the container's loop count and sums its per-frame delays.
///
/// A zero-delay frame contributes 100 ms. These values supplement FFprobe for animated WebP,
/// where the renderer needs the source's loop count and playback duration.
fn webp_animation(bytes: &[u8]) -> Option<WebpAnimation> {
  let mut loops = None;
  let mut duration_ms = 0;
  for (tag, data) in webp_chunks(bytes) {
    if tag == b"ANIM" {
      loops = Some(u16::from_le_bytes(
        bytes.get(data.start + 4..data.end)?.try_into().ok()?,
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
fn normalize_webp_timing(bytes: &mut [u8], duration_ms: u64) -> bool {
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

/// Adds a horizontal stack or forwards a single input under the requested output label.
fn stack(filters: &mut Vec<String>, labels: &[String], output: &str) {
  let inputs = labels
    .iter()
    .map(|label| format!("[{label}]"))
    .collect::<String>();
  if labels.len() == 1 {
    filters.push(format!("{inputs}null[{output}]"));
  } else {
    filters.push(format!("{inputs}hstack=inputs={}[{output}]", labels.len()));
  }
}

/// Builds the FFmpeg filter graph for stacked columns and synchronized overlays.
///
/// For a single input the graph scales directly to the requested size. Multi-input renders
/// group overlays into columns, then stack those columns into the final canvas. Each group is
/// synchronized before overlaying so changes in an animated overlay advance a static base.
fn layout(assets: &[Asset], options: &RenderOptions) -> String {
  if let [asset] = assets {
    let (width, height) = options
      .size
      .map_or((asset.info.width, asset.info.height), |size| {
        let size = u32::from(size.clamp(24, 256));
        asset.info.fit(size, size)
      });
    return format!("[0:v]format=rgba,scale={width}:{height},setsar=1[canvas]");
  }

  let groups: Vec<_> = assets.chunk_by(|_, next| next.overlay).collect();
  let mut height = u32::from(options.size.unwrap_or(64).clamp(24, 256));
  let column_width = |group: &[Asset], height| {
    group
      .iter()
      .map(|asset| asset.info.fit(height, 3 * height).0)
      .max()
      .unwrap_or(1)
  };
  let gap = |height: u32| (height / 16).max(1);
  let width: u32 = groups
    .iter()
    .map(|group| column_width(group, height) + gap(height))
    .sum();
  let staging_width: u32 = groups
    .iter()
    .map(|group| column_width(group, height) * group.len() as u32)
    .sum();
  // Account for the intermediate stacks as well as the final canvas.
  let budget_width = width.max(staging_width.div_ceil(2));
  if budget_width > 2048 {
    height = (height * 2048 / budget_width).max(1);
  }

  let mut filters = Vec::new();
  let mut columns = Vec::new();
  let mut index = 0;
  for group in groups {
    let width = column_width(group, height);
    let mut labels = Vec::new();
    for (position, asset) in group.iter().enumerate() {
      let (w, h) = if options.stretch && position != 0 {
        (width, height)
      } else {
        asset.info.fit(height, 3 * height)
      };
      let label = format!("layer{index}");
      filters.push(format!(
                "[{index}:v]format=rgba,scale={w}:{h},pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1[{label}]"
            ));
      labels.push(label);
      index += 1;
    }

    let mut column = format!("column{index}");
    if labels.len() == 1 {
      stack(&mut filters, &labels, &column);
    } else {
      // Stack first so every layer advances on the union of the input timestamps.
      // Overlay otherwise advances only when its main input supplies a frame.
      let synced = format!("synced{index}");
      stack(&mut filters, &labels, &synced);
      let splits = (0..labels.len())
        .map(|position| format!("[split{index}_{position}]"))
        .collect::<String>();
      filters.push(format!("[{synced}]split={}{splits}", labels.len()));
      let mut previous = None;
      for position in 0..labels.len() {
        let slice = format!("slice{index}_{position}");
        let x = width as usize * position;
        filters.push(format!(
          "[split{index}_{position}]crop={width}:{height}:{x}:0:exact=1[{slice}]"
        ));
        previous = if let Some(base) = previous {
          let output = format!("overlay{index}_{position}");
          filters.push(format!("[{base}][{slice}]overlay=format=rgb[{output}]"));
          Some(output)
        } else {
          Some(slice)
        };
      }
      if let Some(layer) = previous {
        column = layer;
      }
    }
    if index < assets.len() {
      let spaced = format!("spaced{index}");
      let width = width + gap(height);
      filters.push(format!(
        "[{column}]pad={width}:{height}:0:0:color=black@0[{spaced}]"
      ));
      column = spaced;
    }
    columns.push(column);
  }
  stack(&mut filters, &columns, "canvas");
  filters.join(";")
}

/// Renders a PNG or WebP and fits animation timing within one rendering deadline.
///
/// Uses WebP for an animated result or a single WebP input. If frame delays cannot fit the
/// target playback duration, a second encode samples fewer boundaries. Both attempts share
/// the same deadline, and the result is returned only after timing normalization succeeds.
async fn render(directory: &Path, assets: &[Asset], options: RenderOptions) -> Result<Image> {
  let duration_ms = assets.iter().filter_map(|asset| asset.duration_ms).max();
  let single_webp = match assets {
    [asset] => asset.path.extension().is_some_and(|ext| ext == "webp"),
    _ => false,
  };
  let filename = if duration_ms.is_some() || single_webp {
    "emotes.webp"
  } else {
    "emotes.png"
  };
  let output = directory.join(filename);
  let bytes = tokio::time::timeout(Duration::from_secs(25), async {
    let mut bytes = encode(&output, assets, &options, duration_ms, None).await?;
    if let Some(duration) = duration_ms
      && !normalize_webp_timing(&mut bytes, duration)
    {
      // Retry with fewer frame boundaries when the source timings cannot fit as encoded.
      bytes = encode(&output, assets, &options, duration_ms, Some(duration)).await?;
      anyhow::ensure!(
        normalize_webp_timing(&mut bytes, duration),
        "could not preserve the animation duration"
      );
    }
    Ok::<_, anyhow::Error>(bytes)
  })
  .await
  .context("FFmpeg exceeded its 25-second rendering budget")??;
  Ok(Image { bytes, filename })
}

/// Runs FFmpeg with local-only protocols and enforces the attachment size limit.
///
/// `sample` supplies a playback duration for the retry filter, which drops frame boundaries
/// that are too close together. Animated output uses a millisecond time base and preserves a
/// single WebP's loop count when available. Multi-input animation loops indefinitely.
async fn encode(
  output: &Path,
  assets: &[Asset],
  options: &RenderOptions,
  duration_ms: Option<u64>,
  sample: Option<u64>,
) -> Result<Vec<u8>> {
  let composition_duration = duration_ms
    .filter(|_| assets.len() > 1)
    .map(|duration| format!("{duration}ms"));
  let mut command = Command::new("ffmpeg");
  command
    .kill_on_drop(true)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
  command.args([
    "-nostdin",
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-filter_complex_threads",
    "1",
  ]);
  for asset in assets {
    command.args([
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      IMAGE_FORMATS,
      "-threads",
      "1",
      "-max_pixels",
      "4194304",
    ]);
    if asset.webp_animation.is_some() {
      command.args(["-min_delay", "1"]);
    }
    if let Some(duration) = composition_duration.as_ref()
      && asset.duration_ms.is_some()
    {
      command.args(["-ignore_loop", "0", "-t", duration]);
    }
    command.arg("-i").arg(&asset.path);
  }
  let mut filters = layout(assets, options);
  if let Some(color) = options.border {
    filters.push_str(&format!(
      ";[canvas]format=rgba,pad=iw+8:ih+8:4:4:color=0x{color:06x}[decorated]"
    ));
  } else {
    filters.push_str(";[canvas]null[decorated]");
  }
  if let Some(duration) = sample {
    // Dense bursts may contain more frames than fit at the browser's minimum delay.
    let last_start = duration.saturating_sub(MIN_WEBP_FRAME_MS);
    filters.push_str(&format!(
            ";[decorated]settb=1/1000,select='isnan(prev_selected_pts)+gte(pts-prev_selected_pts,{MIN_WEBP_FRAME_MS})*lte(pts,{last_start})'[out]"
        ));
  } else {
    filters.push_str(";[decorated]null[out]");
  }
  command
    .arg("-filter_complex")
    .arg(filters)
    .args(["-map", "[out]", "-an", "-threads", "1", "-fs", "8388608"]);
  if duration_ms.is_some() {
    let loops = match assets {
      [asset] => asset
        .webp_animation
        .as_ref()
        .map_or(0, |source| source.loops),
      _ => 0,
    };
    command
      .args([
        "-c:v",
        "libwebp_anim",
        "-pix_fmt",
        "bgra",
        "-lossless",
        "1",
        "-compression_level",
        "2",
        "-fps_mode",
        "passthrough",
        "-enc_time_base",
        "1:1000",
        "-loop",
      ])
      .arg(loops.to_string());
    if let Some(duration) = composition_duration.as_ref() {
      command.args(["-t", duration]);
    }
  } else {
    command.args(["-frames:v", "1", "-update", "1"]);
    if output.extension().is_some_and(|ext| ext == "webp") {
      command.args(["-c:v", "libwebp", "-lossless", "1"]);
    }
  }
  let status = command.arg(output).output().await?;
  anyhow::ensure!(
    status.status.success(),
    "FFmpeg could not render the composition: {}",
    String::from_utf8_lossy(&status.stderr)
  );
  anyhow::ensure!(
    fs::metadata(output).await?.len() < MAX_ATTACHMENT as u64,
    "composition is too large"
  );
  Ok(fs::read(output).await?)
}

#[cfg(test)]
mod tests;
