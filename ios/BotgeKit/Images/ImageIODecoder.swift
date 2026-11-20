public import CoreGraphics
public import Foundation
import ImageIO

/// Decodes images with ImageIO, which does not depend on WebKit.
///
/// Frames are downsampled to `maxPixelSize` and animations are cut at `maxFrames`, so a hostile
/// or huge provider image cannot exhaust memory.
public struct ImageIODecoder: ImageDecoding {
  /// Delay used when a frame declares none or an unrealistically short one, as browsers do.
  public static let defaultDelay: TimeInterval = 0.1
  /// Shorter declared delays are replaced with ``defaultDelay``.
  static let minimumDelay: TimeInterval = 0.02
  /// Bits per color channel in rendered frames.
  private static let bitsPerComponent = 8

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
    try withImageSource(data) { source throws(ImageDecodingError) in
      try frames(source)
    }
  }

  /// Decodes up to `maxFrames` frames from an opened source.
  ///
  /// - Parameter source: The image source.
  /// - Returns: Every frame with delays, or a still image.
  /// - Throws: ``ImageDecodingError/corruptFrame`` when any frame fails.
  private func frames(_ source: CGImageSource) throws(ImageDecodingError) -> EmoteImage {
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
    try withImageSource(data) { source throws(ImageDecodingError) in
      try frame(source, at: 0, downsampling: needsDownsampling(source))
    }
  }

  /// Opens the data from a temporary file without caching decoded frames, and runs `body`.
  ///
  /// In Lockdown Mode ImageIO decodes in a separate process and, for an in-memory source, copies
  /// the whole file into every frame request. A file-backed source passes the file instead. The
  /// file is removed once `body` returns, so `body` must finish with the source; decoded frames
  /// are rendered bitmaps and stay valid. When the file cannot be written, the data is used
  /// directly.
  ///
  /// - Parameters:
  ///   - data: Image bytes.
  ///   - body: Decodes from the source.
  /// - Returns: What `body` returns.
  /// - Throws: ``ImageDecodingError/unsupported`` when ImageIO cannot read the data, and any
  ///   error `body` throws.
  private func withImageSource<Result>(
    _ data: Data,
    _ body: (CGImageSource) throws(ImageDecodingError) -> Result
  )
    throws(ImageDecodingError) -> Result
  {
    let options = [kCGImageSourceShouldCache: false] as CFDictionary
    let file = FileManager.default
      .temporaryDirectory
      .appending(path: "botge-decode-\(UUID().uuidString)")
    let isWritten = (try? data.write(to: file)) != nil
    defer {
      if isWritten {
        try? FileManager.default.removeItem(at: file)
      }
    }
    let opened = isWritten
      ? CGImageSourceCreateWithURL(file as CFURL, options)
      : CGImageSourceCreateWithData(data as CFData, options)
    guard let source = opened,
          CGImageSourceGetType(source) != nil,
          CGImageSourceGetCount(source) > 0
    else {
      throw .unsupported
    }

    return try body(source)
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

  /// Decodes one frame, downsampled to ``maxPixelSize`` when `downsampling` is set, as a bitmap.
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
        CGImageSourceCreateImageAtIndex(source, index, nil)
      }
    guard let image, let bitmap = Self.bitmap(of: image) else {
      throw .corruptFrame
    }

    return bitmap
  }

  /// Draws `image` into a premultiplied 32-bit bitmap, the layout Core Animation displays directly.
  ///
  /// ImageIO can return frames that decode lazily; in Lockdown Mode it even decodes them in a
  /// separate process. Core Animation would then decode them again on the main thread when a
  /// layer shows them, so every frame is rendered here, off the main thread, instead. Measured
  /// in Lockdown Mode, this costs less than UIKit's `preparingForDisplay()`.
  ///
  /// - Parameter image: A decoded or lazily decoded frame.
  /// - Returns: The rendered bitmap, or `nil` when no bitmap context could be created.
  static func bitmap(of image: CGImage) -> CGImage? {
    guard let context = CGContext(
      data: nil,
      width: image.width,
      height: image.height,
      bitsPerComponent: bitsPerComponent,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        | CGBitmapInfo.byteOrder32Little.rawValue
    )
    else {
      return nil
    }

    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return context.makeImage()
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
