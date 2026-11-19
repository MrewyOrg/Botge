import BotgeKit
import SwiftUI

/// Draws a decoded emote, animating it when `animates` is set.
///
/// Frames advance at most every ``frameInterval``, which covers common emote frame rates while
/// keeping a screen of animated tiles cheap to redraw.
struct AnimatedEmoteView: View {
  /// The shortest time between redraws.
  private static let frameInterval: TimeInterval = 1 / framesPerSecond
  /// Redraws per second at most.
  private static let framesPerSecond: TimeInterval = 30

  /// The decoded image.
  let image: EmoteImage
  /// Whether to play the animation.
  let animates: Bool

  var body: some View {
    if animates, image.duration > 0 {
      TimelineView(.animation(minimumInterval: Self.frameInterval)) { context in
        frameView(image.frame(at: context.date.timeIntervalSinceReferenceDate))
      }
    } else {
      frameView(image.firstFrame)
    }
  }

  /// Shows one frame, or a neutral symbol for a placeholder.
  ///
  /// - Parameter frame: The frame, or `nil` for a placeholder.
  /// - Returns: The frame view.
  @ViewBuilder
  private func frameView(_ frame: CGImage?) -> some View {
    if let frame {
      Image(decorative: frame, scale: 1)
        .resizable()
        .interpolation(.medium)
        .scaledToFit()
    } else {
      Image(systemName: "photo")
        .foregroundStyle(.tertiary)
        .accessibilityHidden(true)
    }
  }
}
