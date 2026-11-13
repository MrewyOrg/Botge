//! Checks aspect-ratio arithmetic and final canvas width budgets.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use anyhow::Result;
use tokio::fs;

use super::super::render;
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
    for border in [None, Some(0x00ff_7700)] {
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
