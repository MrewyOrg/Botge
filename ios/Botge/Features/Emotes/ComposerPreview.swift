import BotgeKit
import SwiftUI

/// Draws the composition as the bot renders it: columns side by side, overlays stacked.
struct ComposerPreview: View {
  /// Height of the preview row.
  private static let height: CGFloat = 56

  /// Columns from ``Composition/columns``.
  let columns: [[CatalogEmote]]

  var body: some View {
    if columns.isEmpty {
      Text("Add emotes from the grid or a preview.")
        .foregroundStyle(.secondary)
    } else {
      ScrollView(.horizontal) {
        HStack(spacing: 0) {
          ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
            ZStack {
              ForEach(Array(column.enumerated()), id: \.offset) { _, layer in
                EmoteImageView(
                  path: layer.image,
                  isAnimated: layer.isAnimated,
                  priority: .userInitiated
                )
              }
            }
            .frame(height: Self.height)
          }
        }
      }
      .accessibilityLabel(columns.flatMap(\.self).map(\.name).joined(separator: ", "))
    }
  }
}
