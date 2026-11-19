public import CoreGraphics
public import Foundation

/// A decoded emote ready for display.
public enum EmoteImage: Sendable {
  /// Every frame decoded, with the delay before each next frame.
  case animated(frames: [CGImage], delays: [TimeInterval])
  /// Nothing could be decoded; the view shows a neutral placeholder.
  case placeholder
  /// A single frame: a still image, or the first frame of an animation that failed to decode.
  case still(CGImage)

  /// The frame shown when animation is off.
  public var firstFrame: CGImage? {
    switch self {
    case let .animated(frames, _):
      frames.first

    case let .still(image):
      image

    case .placeholder:
      nil
    }
  }

  /// The total animation duration, or zero for still images.
  public var duration: TimeInterval {
    if case let .animated(_, delays) = self {
      return delays.reduce(0, +)
    }
    return 0
  }
}
