import BotgeKit
import SwiftUI

/// Loads and shows a catalog image, following the app's animation preference.
struct EmoteImageView: View {
  /// Provides the shared image loader.
  @Environment(AppModel.self) private var model
  /// Whether the system asks to reduce motion.
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// When animated emotes play.
  @AppStorage(PreferenceKey.emotePlayback) private var playback: EmotePlayback = .followReduceMotion
  /// The decoded image once loaded.
  @State private var image: EmoteImage?

  /// The catalog image path.
  let path: String
  /// Whether the provider advertises an animation.
  let isAnimated: Bool

  var body: some View {
    let animates = isAnimated && playback.animates(reduceMotion: reduceMotion)
    Group {
      if let image {
        AnimatedEmoteView(image: image, animates: animates)
      } else {
        ProgressView()
      }
    }
    .task(id: "\(path)|\(animates)") {
      image = await model.imageLoader.image(for: path, animated: animates)
    }
  }
}
