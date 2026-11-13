// cspell:words ANMF apng bgra hstack isnan nostdin rsplit setsar settb

//! Downloads bounded image inputs and renders attachments with `FFmpeg`.
//!
//! [`Layer`] identifies a validated remote image and its place in a composition. The
//! renderer stages inputs in a temporary directory, probes them, and invokes `FFmpeg` with
//! local-only protocols. [`original`] bypasses conversion when the caller needs the source
//! bytes, and [`compose`] handles resizing, borders, and multiple layers.
//!
//! [`mod@layout`] owns fitting and filter graphs, [`probe`] validates local media, and [`webp`]
//! reads animation metadata and normalizes frame timing.

mod layout;
mod probe;
mod webp;

use std::{
  fmt::Write as _,
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

use layout::layout;
use probe::inspect;
use webp::{WebpAnimation, normalize_webp_timing, webp_animation};

const MAX_INPUTS: usize = 32;
const MAX_ASSET: usize = 2 * 1024 * 1024;
const MAX_ATTACHMENT: usize = 20 * 1024 * 1024;

// Bound simultaneous decoder canvases and the source animation's decoded pixel work.
const MAX_SOURCE_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_FRAME_PIXELS: u64 = 256 * 1024 * 1024;
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
  #[cfg(test)]
  pub(crate) fn emote(emote: &Emote) -> Option<Self> {
    Some(Self {
      url: cdn_url(&emote.image, emote.source)?,
      overlay: emote.overlaying,
    })
  }

  /// Selects a published provider scale before applying the CDN allowlist.
  pub(crate) fn emote_at(emote: &Emote, scale: u16) -> Option<Self> {
    Some(Self {
      url: cdn_url(emote.image_at(scale), emote.source)?,
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
///
/// # Errors
///
/// Returns an error if the provider request fails, exceeds the input byte limit, or lacks a
/// supported image signature. No image decoding occurs here.
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
  /// Optional pixel target, independent of provider scale selection in [`Layer::emote_at`].
  /// Values clamp to 24–256: a single image fits that square, while a composition uses the
  /// target as its column height. `None` preserves native dimensions within the width budget.
  pub(crate) size_pixels: Option<u16>,
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
/// dimensions, excessive aggregate pixels or animation frames, missing animation timing,
/// a subprocess failure or deadline, or output above the attachment budget.
/// Any failed input stops the composition.
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
      let file = temp.path().join(format!("{}.{ext}", assets.len()));
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

/// First video stream dimensions and its number of image packets.
///
/// [`inspect`] rejects zero dimensions and bounds decoded pixel counts before construction
/// reaches layout planning.
#[derive(Deserialize)]
struct Dimensions {
  width: u32,
  height: u32,
  #[serde(skip)]
  frames: usize,
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

/// Renders a PNG or WebP and fits animation timing within one rendering deadline.
///
/// Uses WebP for an animated result or a single WebP input. If frame delays cannot fit the
/// target playback duration, a second encode samples fewer boundaries. Both attempts share
/// the same deadline, and the result is returned only after timing normalization succeeds.
///
/// # Errors
///
/// Returns an error for excessive decoded pixels or animation work, failed encoding, the
/// shared 25-second deadline, or animation timing that cannot be preserved.
async fn render(directory: &Path, assets: &[Asset], options: RenderOptions) -> Result<Image> {
  let mut source_pixels = 0u64;
  let mut frame_pixels = 0u64;
  for asset in assets {
    let pixels = u64::from(asset.info.width) * u64::from(asset.info.height);
    source_pixels = source_pixels.saturating_add(pixels);
    frame_pixels = frame_pixels.saturating_add(pixels.saturating_mul(asset.info.frames as u64));
  }
  anyhow::ensure!(
    source_pixels <= MAX_SOURCE_PIXELS && frame_pixels <= MAX_FRAME_PIXELS,
    "composition exceeds the decoded pixel budget; use fewer or smaller images"
  );
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

/// Runs `FFmpeg` with local-only protocols and enforces the attachment size limit.
///
/// Filter labels form a pipeline: layout produces `canvas`, optional padding produces
/// `decorated`, and frame sampling produces the mapped output `out`.
///
/// `sample` supplies a playback duration for the retry filter, which drops frame boundaries
/// that are too close together. Animated output uses a millisecond time base and preserves a
/// single WebP's loop count when available. Multi-input animation loops indefinitely.
///
/// # Errors
///
/// Returns an error if `FFmpeg` cannot run or exits unsuccessfully, the output cannot be read,
/// or the encoded attachment exceeds the byte budget. Its caller owns the overall deadline.
#[expect(
  clippy::too_many_lines,
  reason = "Keep the ordered encoder setup and output validation together"
)]
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
    write!(
      filters,
      ";[canvas]format=rgba,pad=iw+8:ih+8:4:4:color=0x{color:06x}[decorated]"
    )?;
  } else {
    filters.push_str(";[canvas]null[decorated]");
  }
  if let Some(duration) = sample {
    // Dense bursts may contain more frames than fit at the browser's minimum delay.
    let last_start = duration.saturating_sub(MIN_WEBP_FRAME_MS);
    write!(
      filters,
      ";[decorated]settb=1/1000,select='isnan(prev_selected_pts)+gte(pts-prev_selected_pts,{MIN_WEBP_FRAME_MS})*lte(pts,{last_start})'[out]"
    )?;
  } else {
    filters.push_str(";[decorated]null[out]");
  }
  command
    .arg("-filter_complex")
    .arg(filters)
    .args(["-map", "[out]", "-an", "-threads", "1", "-fs"])
    .arg(MAX_ATTACHMENT.to_string());
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
    fs::metadata(output).await?.len() <= MAX_ATTACHMENT as u64,
    "composition is too large"
  );
  Ok(fs::read(output).await?)
}

#[cfg(test)]
mod tests;
