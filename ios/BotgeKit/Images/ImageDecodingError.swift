/// Why image bytes could not be decoded.
public enum ImageDecodingError: Error, Equatable, Sendable {
  /// A frame failed to decode.
  case corruptFrame
  /// The data is not an image format the system can read.
  case unsupported
}
