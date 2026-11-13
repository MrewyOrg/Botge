// cspell:words ANMF

//! Renders small media fixtures with FFmpeg and checks the resulting bytes and playback timing.

use axum::{Router, routing::get};
use base64::{Engine as _, engine::general_purpose::STANDARD};

use super::*;

#[test]
fn fits_extreme_aspect_ratios_without_integer_overflow() {
  let tall = Dimensions {
    width: 1,
    height: 2_097_152,
    frames: 1,
  };
  assert_eq!(tall.fit(2_097_152, 2048), (1, 2_097_152));
  let wide = Dimensions {
    width: 2_097_152,
    height: 1,
    frames: 1,
  };
  assert_eq!(wide.fit(2048, 2048), (2048, 1));
}

#[tokio::test]
async fn bounds_mixed_native_sizes_and_border_padding() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let path = directory.path().join("input.png");
  fs::write(&path, crate::tests::png_pixel()?).await?;
  // The actual pixel supplies cheap input; declared dimensions exercise layout planning.
  for dimensions in [vec![(2000, 100), (100, 1000)], vec![(8192, 1)]] {
    let assets: Vec<_> = dimensions
      .into_iter()
      .map(|(width, height)| Asset {
        info: Dimensions {
          width,
          height,
          frames: 1,
        },
        duration_ms: None,
        path: path.clone(),
        overlay: false,
        webp_animation: None,
      })
      .collect();
    for border in [None, Some(0xff7700)] {
      let output = render(
        directory.path(),
        &assets,
        RenderOptions {
          size_pixels: None,
          stretch: false,
          border,
        },
      )
      .await?;
      let (width, height) = crate::tests::png_dimensions(&output.bytes)?;
      assert!(width <= MAX_CANVAS_WIDTH, "canvas was {width}×{height}");
      assert!(
        width > 2000,
        "layout discarded too much resolution: {width}"
      );
    }
  }
  Ok(())
}

#[tokio::test]
async fn rejects_decoder_memory_and_animation_work_before_starting_ffmpeg() -> Result<()> {
  let directory = tempfile::tempdir()?;
  // Missing inputs would produce an FFmpeg error if encoding were started.
  for (count, frames) in [(5, 1), (1, 100)] {
    let assets: Vec<_> = (0..count)
      .map(|index| Asset {
        info: Dimensions {
          width: 2048,
          height: 2048,
          frames,
        },
        duration_ms: Some(5000),
        path: directory.path().join(format!("missing-{index}.png")),
        overlay: false,
        webp_animation: None,
      })
      .collect();
    let result = render(
      directory.path(),
      &assets,
      RenderOptions {
        size_pixels: Some(24),
        stretch: false,
        border: None,
      },
    )
    .await;
    assert!(matches!(result, Err(error) if error.to_string().contains("decoded pixel budget")));
    assert_eq!(std::fs::read_dir(directory.path())?.count(), 0);
  }
  Ok(())
}

#[test]
fn accepts_only_discord_media_and_maps_the_provider_cache() -> Result<()> {
  let emoji = Layer::discord("<a:Wave:42>").context("expected custom emoji")?;
  assert_eq!(
    emoji.url.as_str(),
    "https://cdn.discordapp.com/emojis/42.gif"
  );
  let attachment = Layer::discord("https://media.discordapp.net/attachments/1/2/test.png?x=1")
    .context("expected attachment")?;
  assert_eq!(attachment.url.path(), "/attachments/1/2/test.png");
  for rejected in [
    "http://cdn.discordapp.com/emojis/42.png",
    "https://cdn.discordapp.com/@me",
    "https://user@cdn.discordapp.com/emojis/42.png",
    "https://cdn.discordapp.com:8080/emojis/42.png",
    "https://127.0.0.1:80/attachments/1/2/test.png",
    "localhost",
    "<:x:invalid>",
  ] {
    assert!(Layer::discord(rejected).is_none());
  }
  let url = Url::parse("https://cdn.betterttv.net/emote/abcd/2x.png?x=1")?;
  let cache = Url::parse("http://nginx:80")?;
  assert_eq!(
    cache_url(&url, Some(&cache)).as_str(),
    "http://nginx/bttv/emote/abcd/2x.png?x=1"
  );
  assert_eq!(cache_url(&url, None), url);
  assert_eq!(image_type(b"GIF87a"), Some("gif"));
  assert_eq!(image_type(b"GIF89a"), Some("gif"));
  assert_eq!(image_type(b"RIFF____WEBP"), Some("webp"));
  assert_eq!(image_type(b"\xff\xd8\xff"), Some("jpg"));
  assert_eq!(image_type(b"<html>"), None);
  Ok(())
}

// cspell:disable
// 8×8 red, green, and blue frames with delays of 73, 117, and 4000 ms.
const ANIMATED_BASE: &str = concat!(
  "UklGRrQAAABXRUJQVlA4WAoAAAACAAAABwAABwAAQU5JTQYAAAD/////AABBTk1GKAAAAAAA",
  "AAAAAAcAAAcAAEkAAAJWUDhMDwAAAC8HwAEABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAcA",
  "AAcAAHUAAABWUDhMDwAAAC8HwAEAB1DAiP4HIqL/AQBBTk1GKAAAAAAAAAAAAAcAAAcAAKAP",
  "AABWUDhMDwAAAC8HwAEABxDR//4HIqL/AQA=",
);

// 4×8 yellow, cyan, and magenta frames with delays of 101, 89, and 59 ms.
const ANIMATED_OVERLAY: &str = concat!(
  "UklGRrQAAABXRUJQVlA4WAoAAAACAAAAAwAABwAAQU5JTQYAAAD/////AwBBTk1GKAAAAAAA",
  "AAAAAAMAAAcAAGUAAAJWUDhMEAAAAC8DwAEAB9D//kf/AxHR/wBBTk1GKAAAAAAAAAAAAAMA",
  "AAcAAFkAAABWUDhMEAAAAC8DwAEAB9D/6H//AxHR/wBBTk1GKAAAAAAAAAAAAAMAAAcAADsA",
  "AABWUDhMEAAAAC8DwAEABxD973//AxHR/wA=",
);

// cspell:enable

/// Reads the encoded frame delays directly from the WebP container.
fn delays(image: &Image) -> Vec<u32> {
  webp_chunks(&image.bytes)
    .filter(|(tag, _)| *tag == b"ANMF")
    .filter_map(|(_, data)| {
      image
        .bytes
        .get(data.start + 12..data.end)
        .and_then(frame_delay)
    })
    .collect()
}

#[tokio::test]
async fn downloads_originals_and_stacks_static_columns_with_a_gap() -> Result<()> {
  let pixel = crate::tests::png_pixel()?;
  let server = crate::tests::TestServer::start(Router::new().route(
    "/7tv/emote/1/2x.png",
    get({
      let pixel = pixel.clone();
      move || async move { pixel }
    }),
  ))
  .await?;
  let layer =
    Layer::emote(&crate::emotes::tests::example("Wave", "1")).context("invalid fixture")?;
  let mut overlay = layer.clone();
  overlay.overlay = true;
  let client = Client::new();
  let image = original(&client, &layer, Some(&server.origin)).await?;
  assert_eq!(image.filename, "emote.png");
  assert_eq!(image.bytes, pixel);
  let png = compose(
    &client,
    &[layer.clone(), overlay, layer],
    Some(&server.origin),
    RenderOptions {
      size_pixels: Some(32),
      stretch: true,
      border: None,
    },
  )
  .await?;
  assert_eq!(png.filename, "emotes.png");
  assert_eq!(image_type(&png.bytes), Some("png"));
  // Two 32 px columns plus a 2 px gap; the overlay shares the first column.
  assert_eq!(crate::tests::png_dimensions(&png.bytes)?, (66, 32));
  assert!(
    compose(
      &client,
      &[],
      Some(&server.origin),
      RenderOptions {
        size_pixels: Some(24),
        stretch: false,
        border: None
      }
    )
    .await
    .is_err()
  );
  Ok(())
}

#[tokio::test]
async fn preserves_webp_timing_and_syncs_static_and_animated_overlays() -> Result<()> {
  let pixel = crate::tests::png_pixel()?;
  let base = STANDARD.decode(ANIMATED_BASE)?;
  let overlay = STANDARD.decode(ANIMATED_OVERLAY)?;
  let server = crate::tests::TestServer::start(
    Router::new()
      .route("/7tv/emote/1/2x.png", get(move || async move { pixel }))
      .route("/7tv/emote/2/2x.webp", get(move || async move { base }))
      .route("/7tv/emote/3/2x.webp", get(move || async move { overlay })),
  )
  .await?;
  let layer = |id: &str, extension: &str, overlay: bool| -> Result<Layer> {
    let mut emote = crate::emotes::tests::example("Wave", id);
    emote.image = format!("https://cdn.7tv.app/emote/{id}/2x.{extension}");
    emote.overlaying = overlay;
    Layer::emote(&emote).context("invalid fixture")
  };
  let client = Client::new();
  let still = layer("1", "png", false)?;
  let base = layer("2", "webp", false)?;
  let overlay = layer("3", "webp", true)?;
  let resize = compose(
    &client,
    std::slice::from_ref(&overlay),
    Some(&server.origin),
    RenderOptions {
      size_pixels: Some(24),
      stretch: false,
      border: None,
    },
  )
  .await?;
  assert_eq!(resize.filename, "emotes.webp");
  assert_eq!(delays(&resize), [101, 89, 59]);
  assert_eq!(
    webp_animation(&resize.bytes)
      .context("missing animation")?
      .loops,
    3
  );

  let still_overlay = compose(
    &client,
    &[still, overlay.clone()],
    Some(&server.origin),
    RenderOptions {
      size_pixels: Some(24),
      stretch: false,
      border: None,
    },
  )
  .await?;
  assert_eq!(delays(&still_overlay), [101, 89, 59]);
  let moving = compose(
    &client,
    &[base, overlay.clone()],
    Some(&server.origin),
    RenderOptions {
      size_pixels: Some(24),
      stretch: false,
      border: None,
    },
  )
  .await?;
  assert!(delays(&moving).starts_with(&[73, 28, 89, 59, 101, 89, 59, 101, 89]));
  assert_eq!(
    webp_animation(&moving.bytes)
      .context("missing composition animation")?
      .duration_ms,
    4190,
  );

  let mut column = overlay;
  column.overlay = false;
  let wide = compose(
    &client,
    &[layer("1", "png", false)?, column],
    Some(&server.origin),
    RenderOptions {
      size_pixels: Some(32),
      stretch: false,
      border: None,
    },
  )
  .await?;
  let dir = tempfile::tempdir()?;
  let file = dir.path().join(wide.filename);
  fs::write(&file, wide.bytes).await?;
  let (size, duration_ms) = inspect(&file).await?;
  assert_eq!((size.width, size.height), (32 + 2 + 16, 32));
  assert_eq!(duration_ms, Some(249));
  let frame = Command::new("ffmpeg")
    .args(["-v", "error", "-i"])
    .arg(&file)
    .args([
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgba",
      "-f",
      "rawvideo",
      "pipe:1",
    ])
    .output()
    .await?;
  assert!(frame.status.success());
  assert_eq!(frame.stdout.len(), 50 * 32 * 4);
  assert_eq!(frame.stdout.get(32 * 4..34 * 4), Some([0; 8].as_slice()));
  assert_eq!(frame.stdout.get(34 * 4 + 3), Some(&255));
  Ok(())
}

#[tokio::test]
async fn rejects_non_images_and_oversized_inputs() -> Result<()> {
  let server = crate::tests::TestServer::start(
    Router::new()
      .route(
        "/7tv/emote/1/2x.png",
        get(|| async { "<html>Provider error</html>" }),
      )
      .route(
        "/7tv/emote/2/2x.png",
        get(|| async { vec![0; MAX_ASSET + 1] }),
      ),
  )
  .await?;
  let client = Client::new();
  for (id, expected) in [
    ("1", "unrecognized emote image format"),
    ("2", "provider response too large"),
  ] {
    let layer =
      Layer::emote(&crate::emotes::tests::example("Wave", id)).context("invalid fixture")?;
    let error = original(&client, &layer, Some(&server.origin))
      .await
      .err()
      .context("accepted invalid input")?;
    assert_eq!(error.to_string(), expected);
  }
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
      .filter(|(tag, _)| *tag == b"ANMF")
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
