import Synchronization

/// Remembers image formats this device refuses to decode, so later loads skip them.
///
/// With Lockdown Mode on, iOS can refuse a format such as WebP outright. Without this, every
/// 7TV emote would download the refused format first and only then fall back, doubling the
/// traffic. A format is skipped after ``limit`` refusals in a row and never once it decodes.
final class FormatHealth: Sendable {
  /// Refusals in a row before a format is skipped.
  static let limit = 3

  /// Refusals in a row per format, and formats that have decoded at least once.
  private let state: Mutex = .init((refusals: [ImageFormat: Int](), decoded: Set<ImageFormat>()))

  deinit {
    // The counters are released with the tracker.
  }

  /// Whether loads should skip `format`.
  ///
  /// - Parameter format: A candidate's format.
  /// - Returns: Whether the format keeps being refused.
  func isSkipped(_ format: ImageFormat) -> Bool {
    state.withLock { state in
      !state.decoded.contains(format) && (state.refusals[format] ?? 0) >= Self.limit
    }
  }

  /// Records whether a download in `format` decoded.
  ///
  /// - Parameters:
  ///   - format: The candidate's format.
  ///   - decoded: Whether it decoded; `false` only for an unsupported format, not a corrupt file.
  func record(_ format: ImageFormat, decoded: Bool) {
    state.withLock { state in
      if decoded {
        state.decoded.insert(format)
        state.refusals[format] = nil
      } else {
        state.refusals[format, default: 0] += 1
      }
    }
  }
}
