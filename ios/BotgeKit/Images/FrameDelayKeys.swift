import ImageIO

/// ImageIO property keys holding a frame's delay in one animated container format.
struct FrameDelayKeys {
  /// Containers that can animate, checked in order.
  static var all: [Self] {
    [
      Self(
        container: kCGImagePropertyGIFDictionary,
        unclamped: kCGImagePropertyGIFUnclampedDelayTime,
        clamped: kCGImagePropertyGIFDelayTime
      ),
      Self(
        container: kCGImagePropertyWebPDictionary,
        unclamped: kCGImagePropertyWebPUnclampedDelayTime,
        clamped: kCGImagePropertyWebPDelayTime
      ),
      Self(
        container: kCGImagePropertyPNGDictionary,
        unclamped: kCGImagePropertyAPNGUnclampedDelayTime,
        clamped: kCGImagePropertyAPNGDelayTime
      )
    ]
  }

  /// The per-frame property dictionary for the format.
  let container: CFString
  /// The delay as authored.
  let unclamped: CFString
  /// The delay after the format's own clamping.
  let clamped: CFString
}
