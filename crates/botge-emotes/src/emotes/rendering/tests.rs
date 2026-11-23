//! Renders small media fixtures with `FFmpeg` and checks the resulting bytes and playback timing.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use axum::{Router, routing::get};
use base64::{Engine as _, engine::general_purpose::STANDARD};

use super::webp::tests::{ANIMATED_OVERLAY, delays};
use super::*;

#[tokio::test]
#[expect(
  clippy::literal_string_with_formatting_args,
  reason = "Braces identify an Axum route capture"
)]
async fn keeps_original_bytes_and_filenames_for_each_supported_image_format() -> Result<()> {
  let server = crate::tests::TestServer::start(Router::new().route(
    "/7tv/emote/{format}/2x.png",
    get(
      |axum::extract::Path(format): axum::extract::Path<String>| async move {
        match format.as_str() {
          "gif" => b"GIF89a".to_vec(),
          "jpg" => vec![255, 216, 255],
          "webp" => b"RIFF1234WEBP".to_vec(),
          _ => vec![],
        }
      },
    ),
  ))
  .await?;
  let http = Client::new();
  for format in ["gif", "jpg", "webp"] {
    let layer = Layer::emote(&botge_test_support::example("Original", format))
      .context("invalid fixture layer")?;
    let image = original(&http, &layer, Some(&server.origin)).await?;
    assert_eq!(image.filename, format!("emote.{format}"));
    assert_eq!(image_type(&image.bytes), Some(format));
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
  assert_eq!(
    Layer::discord("<:Wave:42>")
      .context("missing static emoji")?
      .url
      .path(),
    "/emojis/42.png"
  );
  assert_eq!(image_type(b"RIFF0000xxxx"), None);
  for invalid in [
    "https://:secret@cdn.discordapp.com/emojis/42.png",
    "https://cdn.discordapp.com/emojis/42.png#fragment",
    "https://cdn.discordapp.com/unsupported",
  ] {
    assert!(Layer::discord(invalid).is_none());
  }
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
  let url = Url::parse("https://cdn.7tv.app/emote/abcd/2x.png?x=1")?;
  let cache = Url::parse("http://nginx:80")?;
  assert_eq!(
    cache_url(&url, Some(&cache)).as_str(),
    "http://nginx/7tv/emote/abcd/2x.png?x=1"
  );
  assert_eq!(cache_url(&url, None), url);
  assert_eq!(image_type(b"GIF87a"), Some("gif"));
  assert_eq!(image_type(b"GIF89a"), Some("gif"));
  assert_eq!(image_type(b"RIFF____WEBP"), Some("webp"));
  assert_eq!(image_type(b"\xff\xd8\xff"), Some("jpg"));
  assert_eq!(image_type(b"<html>"), None);
  Ok(())
}

// 8×8 red, green, and blue frames with delays of 73, 117, and 4000 ms.
const ANIMATED_BASE: &str = concat!(
  "UklGRrQAAABXRUJQVlA4WAoAAAACAAAABwAABwAAQU5JTQYAAAD/////AABBTk1GKAAAAAAA",
  "AAAAAAcAAAcAAEkAAAJWUDhMDwAAAC8HwAEABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAcA",
  "AAcAAHUAAABWUDhMDwAAAC8HwAEAB1DAiP4HIqL/AQBBTk1GKAAAAAAAAAAAAAcAAAcAAKAP",
  "AABWUDhMDwAAAC8HwAEABxDR//4HIqL/AQA=",
);

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
  let layer = Layer::emote(&botge_test_support::example("Wave", "1")).context("invalid fixture")?;
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
  std::assert_matches!(
    compose(
      &client,
      &[],
      Some(&server.origin),
      RenderOptions {
        size_pixels: Some(24),
        stretch: false,
        border: None,
      },
    )
    .await,
    Err(_)
  );
  Ok(())
}

#[tokio::test]
#[expect(
  clippy::too_many_lines,
  reason = "Keep the sequential fixture setup, actions, and assertions in one scenario"
)]
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
    let mut emote = botge_test_support::example("Wave", id);
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
      Layer::emote(&botge_test_support::example("Wave", id)).context("invalid fixture")?;
    let error = original(&client, &layer, Some(&server.origin))
      .await
      .err()
      .context("accepted invalid input")?;
    assert_eq!(error.to_string(), expected);
  }
  Ok(())
}

#[tokio::test]
async fn renders_static_webp_and_reports_inaccessible_output_and_invalid_inputs() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let png = directory.path().join("source.png");
  fs::write(&png, crate::tests::png_pixel()?).await?;
  let asset = Asset {
    info: Dimensions {
      width: 1,
      height: 1,
      frames: 1,
    },
    duration_ms: None,
    path: png,
    overlay: false,
    webp_animation: None,
  };
  let options = RenderOptions {
    size_pixels: None,
    stretch: false,
    border: None,
  };
  let webp = directory.path().join("source.webp");
  let bytes = encode(&webp, std::slice::from_ref(&asset), &options, None, None).await?;
  assert_eq!(image_type(&bytes), Some("webp"));
  let asset = Asset {
    path: webp,
    ..asset
  };
  let image = render(directory.path(), std::slice::from_ref(&asset), options).await?;
  assert_eq!(image.filename, "emotes.webp");
  assert_eq!(image_type(&image.bytes), Some("webp"));
  let options = RenderOptions {
    size_pixels: None,
    stretch: false,
    border: None,
  };
  let error = encode(
    &directory.path().join("absent/output.png"),
    std::slice::from_ref(&asset),
    &options,
    None,
    None,
  )
  .await
  .err()
  .context("inaccessible output accepted")?;
  assert!(error.to_string().contains("FFmpeg could not render"));
  let invalid = botge_test_support::example("Untrusted", "bad");
  let mut invalid = invalid;
  invalid.image = "https://untrusted.example/image.png".into();
  assert!(Layer::emote(&invalid).is_none());
  Ok(())
}

#[tokio::test]
async fn rejects_aggregate_input_bytes_and_propagates_encoder_failures() -> Result<()> {
  let mut padded = crate::tests::png_pixel()?;
  padded.resize(MAX_ASSET, 0);
  let server = crate::tests::TestServer::start(Router::new().route(
    "/7tv/emote/padded/2x.png",
    get(move || async move { padded }),
  ))
  .await?;
  let layer = Layer::emote(&botge_test_support::example("Padded", "padded"))
    .context("invalid padded fixture")?;
  let error = compose(
    &Client::new(),
    &vec![layer; 11],
    Some(&server.origin),
    RenderOptions {
      size_pixels: None,
      stretch: false,
      border: None,
    },
  )
  .await
  .err()
  .context("aggregate input budget was ignored")?;
  assert!(
    error.to_string().contains("inputs exceed 20 MiB"),
    "{error:#}"
  );
  let directory = tempfile::tempdir()?;
  let asset = Asset {
    info: Dimensions {
      width: 1,
      height: 1,
      frames: 1,
    },
    path: directory.path().join("absent.png"),
    duration_ms: None,
    overlay: false,
    webp_animation: None,
  };
  let error = render(
    directory.path(),
    &[asset],
    RenderOptions {
      size_pixels: None,
      stretch: false,
      border: None,
    },
  )
  .await
  .err()
  .context("encoder failure was lost")?;
  assert!(error.to_string().contains("FFmpeg could not render"));
  Ok(())
}

/// Two lossy frames followed by two lossless frames: the decoder switches from `yuva420p` to `argb`.
const MIXED_FORMAT: &str = "UklGRhwBAABXRUJQVlA4WAoAAAACAAAABwAABwAAQU5JTQYAAAD/////AABBTk1GQgAAAAAAAAAAAAcAAAcAABQAAAJWUDggKgAAAPABAJ0BKggACAACwEwloAJ0ugH4AATIAACb/8btxhvwXf+YJX5BuuQAAEFOTUZCAAAAAAAAAAAABwAABwAAFAAAAFZQOCAqAAAA1AEAnQEqCAAIAAAATCWgAnS6AfgAA7AA/rZX/4hno9TJd/8WcjEdl4AAQU5NRioAAAAAAAAAAAAHAAAHAAAUAAAAVlA4TBEAAAAvB8ABAAfQz3r1vf+BiOh/AABBTk1GKgAAAAAAAAAAAAcAAAcAABQAAABWUDhMEQAAAC8HwAEAB9DP+vW9/4GI6H8AAA==";

#[tokio::test]
async fn composes_still_images_with_animations_that_switch_pixel_formats() -> Result<()> {
  let pixel = crate::tests::png_pixel()?;
  let mixed = STANDARD.decode(MIXED_FORMAT)?;
  let server = crate::tests::TestServer::start(
    Router::new()
      .route("/7tv/emote/1/2x.png", get(move || async move { pixel }))
      .route("/7tv/emote/2/2x.webp", get(move || async move { mixed })),
  )
  .await?;
  let layer = |id: &str, extension: &str, overlay: bool| -> Result<Layer> {
    let mut emote = botge_test_support::example("Mixed", id);
    emote.image = format!("https://cdn.7tv.app/emote/{id}/2x.{extension}");
    emote.overlaying = overlay;
    Layer::emote(&emote).context("invalid fixture")
  };
  let client = Client::new();
  let still = layer("1", "png", false)?;
  // Side by side, and as an overlay on the still image: both previously stalled until the deadline.
  for layers in [
    [still.clone(), layer("2", "webp", false)?],
    [still.clone(), layer("2", "webp", true)?],
  ] {
    let options = RenderOptions {
      size_pixels: Some(16),
      stretch: false,
      border: None,
    };
    let image = tokio::time::timeout(
      Duration::from_secs(15),
      compose(&client, &layers, Some(&server.origin), options),
    )
    .await
    .context("rendering stalled")??;
    assert_eq!(image.filename, "emotes.webp");
    assert_eq!(delays(&image), [20, 20, 20, 20]);
  }
  Ok(())
}
