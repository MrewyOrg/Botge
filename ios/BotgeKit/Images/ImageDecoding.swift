public import CoreGraphics
public import Foundation

/// Decodes image bytes; ``ImageIODecoder`` is the production implementation.
public protocol ImageDecoding: Sendable {
  /// Decodes every frame, bounded by the decoder's frame and pixel limits.
  ///
  /// - Parameter data: Image bytes.
  /// - Returns: Every frame with delays, or a still image.
  /// - Throws: ``ImageDecodingError`` when the data is not a supported animation.
  func decodeFrames(_ data: Data) throws(ImageDecodingError) -> EmoteImage

  /// Decodes only the first frame.
  ///
  /// - Parameter data: Image bytes.
  /// - Returns: The first frame.
  /// - Throws: ``ImageDecodingError`` when no frame can be decoded.
  func decodeFirstFrame(_ data: Data) throws(ImageDecodingError) -> CGImage
}
