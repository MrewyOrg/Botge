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

  /// The frame to show `elapsed` seconds after the animation started, looping forever.
  ///
  /// Still images and animations without a positive duration show their first frame.
  ///
  /// - Parameter elapsed: Seconds since the animation started; negative values count as zero.
  /// - Returns: The frame, or `nil` for a placeholder.
  public func frame(at elapsed: TimeInterval) -> CGImage? {
    guard case let .animated(frames, delays) = self, duration > 0 else {
      return firstFrame
    }

    var remaining = max(elapsed, 0).truncatingRemainder(dividingBy: duration)
    for (frame, delay) in zip(frames, delays) {
      if remaining < delay {
        return frame
      }

      remaining -= delay
    }
    return frames.last
  }
}
