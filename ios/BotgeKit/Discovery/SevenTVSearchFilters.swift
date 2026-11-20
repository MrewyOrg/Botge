/// Flag filters for a 7TV discovery search; a flag is sent only when the filter restricts it.
struct SevenTVSearchFilters: Encodable {
  /// The 7TV flag names.
  private enum CodingKeys: String, CodingKey {
    case isAnimated = "animated"
    case isNSFW = "nsfw"
    case isOverlay = "defaultZeroWidth"
  }

  /// Animated, still, or either.
  let motion: MotionFilter
  /// Overlays, regular emotes, or either.
  let overlay: OverlayFilter

  /// Writes `nsfw: false` and the restricted flags.
  ///
  /// - Parameter encoder: The JSON encoder.
  /// - Throws: An `EncodingError` from the encoder.
  func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(false, forKey: .isNSFW)
    if motion != .any {
      try container.encode(motion == .animated, forKey: .isAnimated)
    }
    if overlay != .any {
      try container.encode(overlay == .overlaying, forKey: .isOverlay)
    }
  }
}
