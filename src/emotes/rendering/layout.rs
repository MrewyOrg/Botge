// cspell:words hstack setsar

//! Fits image dimensions and builds bounded column and overlay filter graphs.

use std::fmt::Write as _;

use super::{Asset, Dimensions, RenderOptions};

pub(super) const MAX_CANVAS_WIDTH: u32 = 2048;

impl Dimensions {
  /// Fits within positive height and width bounds while preserving aspect ratio.
  ///
  /// # Panics
  ///
  /// Panics if the source height is zero. Production callers use dimensions validated by
  /// [`super::probe::inspect`], which rejects zero-sized images.
  #[expect(
    clippy::cast_possible_truncation,
    reason = "Width is bounded by max_width; reducing width bounds the fitted height by height"
  )]
  pub(super) fn fit(&self, height: u32, max_width: u32) -> (u32, u32) {
    let source_width = u64::from(self.width);
    let source_height = u64::from(self.height);
    let width = (source_width * u64::from(height) + source_height / 2) / source_height;
    if width > u64::from(max_width) {
      (
        max_width,
        ((source_height * u64::from(max_width) + source_width / 2) / source_width).max(1) as u32,
      )
    } else {
      (width.max(1) as u32, height)
    }
  }
}

/// Adds a horizontal stack or forwards a single input under the requested output label.
fn stack(filters: &mut Vec<String>, labels: &[String], output: &str) {
  let mut inputs = String::new();
  for label in labels {
    inputs.push('[');
    inputs.push_str(label);
    inputs.push(']');
  }
  if labels.len() == 1 {
    filters.push(format!("{inputs}null[{output}]"));
  } else {
    filters.push(format!("{inputs}hstack=inputs={}[{output}]", labels.len()));
  }
}

/// Builds the `FFmpeg` filter graph for stacked columns and synchronized overlays.
///
/// For a single input the graph scales directly to the requested size. Multi-input renders
/// group overlays into columns, then stack those columns into the final canvas. Each group is
/// synchronized before overlaying so changes in an animated overlay advance a static base.
#[expect(
  clippy::too_many_lines,
  reason = "Keep the ordered filter-graph construction together for review"
)]
pub(super) fn layout(assets: &[Asset], options: &RenderOptions) -> String {
  // Reserve border padding inside the final attachment's width budget.
  let max_width = MAX_CANVAS_WIDTH - options.border.map_or(0, |_| 8);
  if let [asset] = assets {
    let (width, height) = options.size_pixels.map_or_else(
      || asset.info.fit(asset.info.height, max_width),
      |size| {
        let size = u32::from(size.clamp(24, 256));
        asset.info.fit(size, size)
      },
    );
    return format!("[0:v]format=rgba,scale={width}:{height},setsar=1[canvas]");
  }

  // Each base starts a column. Leading overlays form a column of their own.
  let groups: Vec<_> = assets.chunk_by(|_, next| next.overlay).collect();
  let mut height = options.size_pixels.map_or_else(
    || {
      assets
        .iter()
        .map(|asset| asset.info.height)
        .max()
        .unwrap_or(1)
    },
    |size| u32::from(size.clamp(24, 256)),
  );
  // Both width planning and layer rendering must use the same fit calculation.
  let layer_size = |asset: &Asset, height: u32| {
    let target_height = if options.size_pixels.is_none() {
      height.min(asset.info.height)
    } else {
      height
    };
    asset.info.fit(target_height, 3 * height)
  };
  let column_width = |group: &[Asset], height: u32| {
    group
      .iter()
      .map(|asset| layer_size(asset, height).0)
      .max()
      .unwrap_or(1)
  };
  let gap = |height: u32| (height / 16).max(1);
  let budget_width = |height| {
    let widths: Vec<_> = groups
      .iter()
      .map(|group| u64::from(column_width(group, height)))
      .collect();
    let width =
      widths.iter().sum::<u64>() + groups.len().saturating_sub(1) as u64 * u64::from(gap(height));
    let staging_width: u64 = widths
      .iter()
      .zip(&groups)
      .map(|(width, group)| width * group.len() as u64)
      .sum();
    width.max(staging_width.div_ceil(2))
  };
  if budget_width(height) > u64::from(max_width) {
    // Native-size caps and integer rounding make width non-proportional to height.
    // Search the monotone sizing function instead of applying a one-shot ratio.
    let mut low = 1;
    let mut high = height;
    while low < high {
      let middle = low + (high - low).div_ceil(2);
      if budget_width(middle) <= u64::from(max_width) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    height = low;
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
        layer_size(asset, height)
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
      let mut splits = String::new();
      for position in 0..labels.len() {
        #[expect(
          clippy::let_underscore_must_use,
          reason = "Writing into a String cannot fail"
        )]
        let _ = write!(splits, "[split{index}_{position}]");
      }
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

#[cfg(test)]
mod tests;
