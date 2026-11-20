import BotgeKit
import SwiftUI

/// Loads and shows a catalog image, following the app's animation preference.
///
/// An image already in memory shows at once, so tiles scrolled back into view never reload. A
/// new image shows its first frame as soon as it decodes, then starts animating once every frame
/// is ready. With a fallback, such as the grid image behind a larger preview, the fallback keeps
/// playing until the new image is fully ready, so opening a preview never looks like a reload.
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
  /// An image path to show until ``path`` is ready, such as the smaller grid image.
  let fallbackPath: String?
  /// How urgently to load: grid tiles load in the background, a preview the user opened first.
  let priority: TaskPriority

  var body: some View {
    let animates = isAnimated && playback.animates(reduceMotion: reduceMotion)
    Group {
      if let shown = shown(animated: animates) {
        AnimatedEmoteView(image: shown, animates: animates)
      } else {
        RoundedRectangle(cornerRadius: Self.placeholderRadius)
          .fill(.fill.tertiary)
          .accessibilityHidden(true)
      }
    }
    .task(id: "\(path)|\(animates)", priority: priority) {
      await load(animated: animates)
    }
  }

  /// Creates an image view.
  ///
  /// - Parameters:
  ///   - path: The catalog image path.
  ///   - isAnimated: Whether the provider advertises an animation.
  ///   - fallbackPath: An image path to show until `path` is ready, or `nil`.
  ///   - priority: How urgently to load.
  init(path: String, isAnimated: Bool, fallbackPath: String?, priority: TaskPriority) {
    self.path = path
    self.isAnimated = isAnimated
    self.fallbackPath = fallbackPath
    self.priority = priority
  }

  /// The image to show now: the loaded one, else ``path`` or the fallback from memory.
  ///
  /// - Parameter animated: Whether the animation is wanted.
  /// - Returns: An image, or `nil` to show the placeholder.
  private func shown(animated: Bool) -> EmoteImage? {
    image ?? cached(path, animated: animated)
      ?? fallbackPath.flatMap { cached($0, animated: animated) }
  }

  /// The best image of `path` already in memory: the animation when wanted, else the first
  /// frame.
  ///
  /// - Parameters:
  ///   - path: A catalog image path.
  ///   - animated: Whether the animation is wanted.
  /// - Returns: A cached image, or `nil`.
  private func cached(_ path: String, animated: Bool) -> EmoteImage? {
    let loader = model.imageLoader
    return (animated ? loader.cachedImage(for: path, animated: true) : nil)
      ?? loader.cachedImage(for: path, animated: false)
  }

  /// Whether `image` is the placeholder for a failed load.
  ///
  /// - Parameter image: A loaded image.
  /// - Returns: Whether nothing decoded.
  private static func isPlaceholder(_ image: EmoteImage) -> Bool {
    if case .placeholder = image {
      return true
    }

    return false
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

    // A playing fallback stays on screen instead of a still frame or a failed load.
    let hasFallback = fallbackPath.flatMap { cached($0, animated: animated) } != nil
    let still = await loader.image(for: path, animated: false)
    guard !Task.isCancelled else {
      return
    }

    if !hasFallback || (!animated && !Self.isPlaceholder(still)) {
      image = still
    }
    if animated, case .still = still {
      let full = await loader.image(for: path, animated: true)
      if !Task.isCancelled, !Self.isPlaceholder(full) || !hasFallback {
        image = full
      }
    }
  }
}
