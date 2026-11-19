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
  var isSelected = false
  /// Whether a tap selects the emote instead of previewing it.
  var isSelecting = false

  var body: some View {
    VStack(spacing: Self.labelSpacing) {
      EmoteImageView(path: emote.image, isAnimated: emote.isAnimated)
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
}
