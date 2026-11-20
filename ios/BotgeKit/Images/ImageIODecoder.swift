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
    let downsamples = needsDownsampling(source)
    guard count > 1 else {
      return try .still(frame(source, at: 0, downsampling: downsamples))
    }

    var frames = [CGImage]()
    var delays = [TimeInterval]()
    frames.reserveCapacity(count)
    delays.reserveCapacity(count)
    for index in 0 ..< count {
      try frames.append(frame(source, at: index, downsampling: downsamples))
      delays.append(Self.delay(source, at: index))
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
    let source = try imageSource(data)
    return try frame(source, at: 0, downsampling: needsDownsampling(source))
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

  /// Whether the first frame is larger than ``maxPixelSize`` or its size is unknown.
  ///
  /// - Parameter source: The image source.
  /// - Returns: Whether frames go through the slower thumbnail path.
  private func needsDownsampling(_ source: CGImageSource) -> Bool {
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    guard let width = properties?[kCGImagePropertyPixelWidth] as? Int,
          let height = properties?[kCGImagePropertyPixelHeight] as? Int
    else {
      return true
    }

    return max(width, height) > maxPixelSize
  }

  /// Decodes one frame, downsampled to ``maxPixelSize`` when `downsampling` is set.
  ///
  /// Frames that already fit decode directly, which is faster than building a thumbnail.
  ///
  /// - Parameters:
  ///   - source: The image source.
  ///   - index: The frame index.
  ///   - downsampling: Whether to scale the frame down to ``maxPixelSize``.
  /// - Returns: The decoded frame.
  /// - Throws: ``ImageDecodingError/corruptFrame`` when the frame cannot be decoded.
  private func frame(
    _ source: CGImageSource,
    at index: Int,
    downsampling: Bool
  )
    throws(ImageDecodingError) -> CGImage
  {
    let image =
      if downsampling {
        CGImageSourceCreateThumbnailAtIndex(source, index, [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceShouldCacheImmediately: true,
          kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ] as CFDictionary)
      } else {
        CGImageSourceCreateImageAtIndex(source, index, [
          kCGImageSourceShouldCacheImmediately: true
        ] as CFDictionary)
      }
    guard let image else {
      throw .corruptFrame
    }

    return image
  }

  /// The frame delay from GIF, WebP or APNG metadata, preferring the unclamped value.
  ///
  /// - Parameters:
  ///   - source: The image source.
  ///   - index: The frame index.
  /// - Returns: The declared delay, or ``defaultDelay`` when it is missing or shorter than
  ///   ``minimumDelay``.
  static func delay(_ source: CGImageSource, at index: Int) -> TimeInterval {
    let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
    for keys in FrameDelayKeys.all {
      guard let values = properties?[keys.container] as? [CFString: Any] else {
        continue
      }

      let declared = [keys.unclamped, keys.clamped].lazy.compactMap { values[$0] as? Double }.first
      guard let declared, declared >= minimumDelay else {
        return defaultDelay
      }

      return declared
    }
    return defaultDelay
  }
}
