import BotgeKit
import SwiftUI

/// Loads and shows a catalog image, following the app's animation preference.
///
/// An image already in memory shows at once, so tiles scrolled back into view never reload. A
/// new image shows its first frame as soon as it decodes, then starts animating once every frame
/// is ready.
struct EmoteImageView: View {
  /// Corner radius of the loading placeholder.
  private static let placeholderRadius: CGFloat = 8

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
      if let shown = image ?? cached(animated: animates) {
        AnimatedEmoteView(image: shown, animates: animates)
      } else {
        RoundedRectangle(cornerRadius: Self.placeholderRadius)
          .fill(.fill.tertiary)
          .accessibilityHidden(true)
      }
    }
    .task(id: "\(path)|\(animates)") {
      await load(animated: animates)
    }
  }

  /// The best image already in memory: the animation when wanted, else the first frame.
  ///
  /// - Parameter animated: Whether the animation is wanted.
  /// - Returns: A cached image, or `nil`.
  private func cached(animated: Bool) -> EmoteImage? {
    let loader = model.imageLoader
    return (animated ? loader.cachedImage(for: path, animated: true) : nil)
      ?? loader.cachedImage(for: path, animated: false)
  }

  /// Loads the first frame, then the animation when wanted.
  ///
  /// - Parameter animated: Whether to load every frame.
  private func load(animated: Bool) async {
    let loader = model.imageLoader
    if animated, let full = loader.cachedImage(for: path, animated: true) {
      image = full
      return
    }

    let still = await loader.image(for: path, animated: false)
    guard !Task.isCancelled else {
      return
    }

    image = still
    if animated, case .still = still {
      let full = await loader.image(for: path, animated: true)
      if !Task.isCancelled {
        image = full
      }
    }
  }
}
