public import CoreGraphics
public import Foundation
import ImageIO

/// Decodes images with ImageIO, which runs in-process and does not depend on WebKit.
///
/// Frames are downsampled to `maxPixelSize` and animations are cut at `maxFrames`, so a hostile
/// or huge provider image cannot exhaust memory.
public struct ImageIODecoder: ImageDecoding {
  /// Delay used when a frame declares none or an unrealistically short one, as browsers do.
  public static let defaultDelay: TimeInterval = 0.1
  /// Shorter declared delays are replaced with ``defaultDelay``.
  static let minimumDelay: TimeInterval = 0.02

  /// Longest decoded edge in pixels.
  private let maxPixelSize: Int
  /// Frames decoded at most; later frames are dropped.
  private let maxFrames: Int

  /// Creates a decoder with explicit bounds.
  ///
  /// - Parameters:
  ///   - maxPixelSize: Longest decoded edge in pixels.
  ///   - maxFrames: Most frames decoded.
  public init(maxPixelSize: Int = 256, maxFrames: Int = 240) {
    self.maxPixelSize = maxPixelSize
    self.maxFrames = maxFrames
  }

  /// Decodes up to `maxFrames` frames.
  ///
  /// - Parameter data: Image bytes.
  /// - Returns: Every frame with delays, or a still image.
  /// - Throws: ``ImageDecodingError/unsupported`` for unreadable data and
  ///   ``ImageDecodingError/corruptFrame`` when any frame fails.
  public func decodeFrames(_ data: Data) throws(ImageDecodingError) -> EmoteImage {
    let source = try imageSource(data)
    let count = min(CGImageSourceGetCount(source), maxFrames)
    guard count > 1 else {
      return try .still(frame(source, at: 0))
    }

    var frames = [CGImage]()
    var delays = [TimeInterval]()
    frames.reserveCapacity(count)
    delays.reserveCapacity(count)
    for index in 0 ..< count {
      try frames.append(frame(source, at: index))
      delays.append(delay(source, at: index))
    }
    return .animated(frames: frames, delays: delays)
  }

  /// Decodes the first frame only.
  ///
  /// - Parameter data: Image bytes.
  /// - Returns: The first frame.
  /// - Throws: ``ImageDecodingError/unsupported`` for unreadable data and
  ///   ``ImageDecodingError/corruptFrame`` when the frame fails.
  public func decodeFirstFrame(_ data: Data) throws(ImageDecodingError) -> CGImage {
    try frame(imageSource(data), at: 0)
  }

  /// Opens the data without caching decoded frames.
  ///
  /// - Parameter data: Image bytes.
  /// - Returns: An image source with at least one frame.
  /// - Throws: ``ImageDecodingError/unsupported`` when ImageIO cannot read the data.
  private func imageSource(_ data: Data) throws(ImageDecodingError) -> CGImageSource {
    let options = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithData(data as CFData, options),
          CGImageSourceGetType(source) != nil,
          CGImageSourceGetCount(source) > 0
    else {
      throw .unsupported
    }

    return source
  }

  /// Decodes one frame, downsampled to ``maxPixelSize``.
  ///
  /// - Parameters:
  ///   - source: The image source.
  ///   - index: The frame index.
  /// - Returns: The downsampled frame.
  /// - Throws: ``ImageDecodingError/corruptFrame`` when the frame cannot be decoded.
  private func frame(_ source: CGImageSource, at index: Int) throws(ImageDecodingError) -> CGImage {
    let options = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
    ] as CFDictionary
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, index, options) else {
      throw .corruptFrame
    }

    return image
  }

  /// The frame delay from GIF, WebP or APNG metadata.
  ///
  /// - Parameters:
  ///   - source: The image source.
  ///   - index: The frame index.
  /// - Returns: Seconds before the next frame.
  private func delay(_ source: CGImageSource, at index: Int) -> TimeInterval {
    let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
    for keys in FrameDelayKeys.all {
      guard let values = properties?[keys.container] as? [CFString: Any] else {
        continue
      }

      let value = (values[keys.unclamped] as? Double) ?? (values[keys.clamped] as? Double) ?? 0
      return value >= Self.minimumDelay ? value : Self.defaultDelay
    }
    return Self.defaultDelay
  }
}
