import BotgeKit
import SwiftUI

/// One emote in the grid: its image and name.
struct EmoteTile: View {
  /// Side length of the emote image.
  private static let imageSize: CGFloat = 56
  /// Space between the image and the name.
  private static let labelSpacing: CGFloat = 4

  /// The emote shown.
  let emote: CatalogEmote

  var body: some View {
    VStack(spacing: Self.labelSpacing) {
      EmoteImageView(path: emote.image, isAnimated: emote.isAnimated)
        .frame(width: Self.imageSize, height: Self.imageSize)
      Text(emote.name)
        .font(.caption)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .frame(maxWidth: .infinity)
    .contentShape(.rect)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(emote.name)
    .accessibilityHint("Shows the emote preview")
    .accessibilityIdentifier("emote.\(emote.name)")
  }
}
