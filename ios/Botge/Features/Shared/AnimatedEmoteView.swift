import BotgeKit
import SwiftUI

/// Draws a decoded emote, animating it when `animates` is set.
///
/// Frames play through Core Animation in ``EmoteFramesView``; the view keeps the image's aspect
/// ratio and shows a neutral symbol for a placeholder.
struct AnimatedEmoteView: View {
  /// The decoded image.
  let image: EmoteImage
  /// Whether to play the animation.
  let animates: Bool

  var body: some View {
    if let frame = image.firstFrame {
      EmoteFramesView(image: image, animates: animates)
        .aspectRatio(CGSize(width: frame.width, height: frame.height), contentMode: .fit)
    } else {
      Image(systemName: "photo")
        .foregroundStyle(.tertiary)
        .accessibilityHidden(true)
    }
  }
}
