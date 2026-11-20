import BotgeKit
import QuartzCore
import SwiftUI
import UIKit

/// Shows a decoded emote in a layer, letting Core Animation play its frames.
///
/// An animation becomes a discrete keyframe animation of the layer's contents, so the render
/// server swaps frames without redrawing the view. Every layer showing an animation of the same
/// length follows one shared clock, so repeated emotes stay in step.
struct EmoteFramesView: UIViewRepresentable {
  /// The layer animation key for the frames.
  static let animationKey = "frames"

  /// The decoded image.
  let image: EmoteImage
  /// Whether to play the animation.
  let animates: Bool

  /// Applies `image` to `layer`, starting, keeping or removing its frame animation.
  ///
  /// The layer shows the first frame whenever nothing plays. An animation already playing the
  /// same frames keeps running, so redraws never restart it.
  ///
  /// - Parameters:
  ///   - image: The decoded image.
  ///   - animates: Whether to play the animation.
  ///   - layer: The layer to configure.
  static func show(_ image: EmoteImage, animates: Bool, in layer: CALayer) {
    layer.contentsGravity = .resizeAspect
    layer.contents = image.firstFrame
    guard animates, case let .animated(frames, _) = image, image.duration > 0 else {
      layer.removeAnimation(forKey: animationKey)
      return
    }
    guard !isPlaying(frames, in: layer) else {
      return
    }

    let animation = CAKeyframeAnimation(keyPath: "contents")
    animation.values = frames
    // Core Animation takes key times only as Objective-C numbers.
    // swiftlint:disable:next legacy_objc_type
    animation.keyTimes = image.keyTimes.map { NSNumber(value: $0) }
    animation.calculationMode = .discrete
    animation.duration = image.duration
    animation.repeatCount = .infinity
    animation.isRemovedOnCompletion = false
    animation.timeOffset = CACurrentMediaTime().truncatingRemainder(dividingBy: image.duration)
    layer.add(animation, forKey: animationKey)
  }

  /// Whether `layer` already plays exactly `frames`.
  ///
  /// - Parameters:
  ///   - frames: The frames to show.
  ///   - layer: The layer to check.
  /// - Returns: Whether the current animation shows the same frame objects in the same order.
  private static func isPlaying(_ frames: [CGImage], in layer: CALayer) -> Bool {
    guard let playing = layer.animation(forKey: animationKey) as? CAKeyframeAnimation,
          let values = playing.values, values.count == frames.count
    else {
      return false
    }

    return zip(values, frames).allSatisfy { $0 as AnyObject === $1 }
  }

  /// Creates a plain view whose layer shows the frames.
  ///
  /// - Parameter context: The representable context.
  /// - Returns: The view.
  func makeUIView(context _: Context) -> UIView {
    let view = UIView()
    view.isUserInteractionEnabled = false
    return view
  }

  /// Applies the current image and playback setting.
  ///
  /// - Parameters:
  ///   - uiView: The view from ``makeUIView(context:)``.
  ///   - context: The representable context.
  func updateUIView(_ uiView: UIView, context _: Context) {
    Self.show(image, animates: animates, in: uiView.layer)
  }
}
