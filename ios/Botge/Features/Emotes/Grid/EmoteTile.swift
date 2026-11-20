import BotgeKit
import SwiftUI

/// One emote in the grid: its image and name.
struct EmoteTile: View {
  /// Space between the image and the name.
  private static let labelSpacing: CGFloat = 4

  /// Side length of the emote image, growing with the text size.
  @ScaledMetric private var imageSize: CGFloat = 56

  /// The emote shown.
  let emote: CatalogEmote
  /// Whether the emote is selected for a batch action.
  let isSelected: Bool
  /// Whether a tap selects the emote instead of previewing it.
  let isSelecting: Bool

  var body: some View {
    VStack(spacing: Self.labelSpacing) {
      EmoteImageView(
        path: emote.image,
        isAnimated: emote.isAnimated,
        fallbackPath: nil,
        priority: .utility
      )
      .frame(width: imageSize, height: imageSize)
      Text(emote.name)
        .font(.caption)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .frame(maxWidth: .infinity)
    .overlay(alignment: .topTrailing) {
      if isSelected {
        Image(systemName: "checkmark.circle.fill")
          .symbolRenderingMode(.multicolor)
          .accessibilityHidden(true)
      }
    }
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(emote.name)
    .accessibilityHint(isSelecting ? "Selects or deselects the emote" : "Shows the emote preview")
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .accessibilityIdentifier("emote.\(emote.name)")
  }

  /// Creates a tile.
  ///
  /// - Parameters:
  ///   - emote: The emote shown.
  ///   - isSelected: Whether the emote is selected for a batch action.
  ///   - isSelecting: Whether a tap selects the emote instead of previewing it.
  init(emote: CatalogEmote, isSelected: Bool, isSelecting: Bool) {
    self.emote = emote
    self.isSelected = isSelected
    self.isSelecting = isSelecting
  }
}
