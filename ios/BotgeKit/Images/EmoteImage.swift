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

  /// When each frame starts, as fractions of ``duration``, followed by `1`.
  ///
  /// The values suit a discrete `CAKeyframeAnimation` over the frames, which needs one more key
  /// time than frames. Still images, placeholders and animations without a positive duration have
  /// none.
  public var keyTimes: [Double] {
    guard case let .animated(_, delays) = self, duration > 0 else {
      return []
    }

    var start = 0.0
    var times = [Double]()
    times.reserveCapacity(delays.count + 1)
    for delay in delays {
      times.append(start / duration)
      start += delay
    }
    times.append(1)
    return times
  }
}
