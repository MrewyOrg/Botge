import CoreGraphics
import Synchronization

/// A thread-safe, least-recently-used cache of decoded emotes, bounded by decoded bytes.
///
/// Views read it synchronously while they render, so an emote scrolled back into view shows at
/// once instead of waiting for the loader. Animated emotes cost far more than still ones, so the
/// bound is in bytes rather than entries.
public final class EmoteImageCache: Sendable {
  /// One cached image with its size and last use.
  private struct Entry {
    /// The decoded image.
    let image: EmoteImage
    /// Decoded bytes the image holds.
    let cost: Int
    /// The ``State/clock`` value at the last read or write.
    var lastUse: Int
  }

  /// The mutable cache state behind the lock.
  private struct State {
    /// Entries by key.
    var entries: [String: Entry] = [:]
    /// The sum of every entry's cost.
    var totalCost = 0
    /// Increases on every read or write, ordering entries by recency.
    var clock = 0
  }

  /// Bytes kept at most; the least recently used images are dropped beyond it.
  public let costLimit: Int
  /// The entries, guarded for access from any thread.
  private let state: Mutex = .init(State())

  /// The number of cached images.
  public var count: Int {
    state.withLock { $0.entries.count }
  }

  /// Whether the cache holds no images.
  public var isEmpty: Bool {
    state.withLock { $0.entries.isEmpty }
  }

  /// Creates an empty cache.
  ///
  /// - Parameter costLimit: Decoded bytes kept at most.
  public init(costLimit: Int) {
    self.costLimit = costLimit
  }

  deinit {
    // The images are released with the cache.
  }

  /// The decoded bytes an image holds, at four bytes per pixel.
  ///
  /// - Parameter image: A decoded image.
  /// - Returns: Bytes across every frame; zero for a placeholder.
  public static func cost(of image: EmoteImage) -> Int {
    let bytesPerPixel = 4
    return switch image {
    case let .animated(frames, _):
      frames.reduce(0) { $0 + $1.width * $1.height * bytesPerPixel }

    case .placeholder:
      0

    case let .still(frame):
      frame.width * frame.height * bytesPerPixel
    }
  }

  /// Returns the image for `key` and marks it as recently used.
  ///
  /// - Parameter key: The cache key.
  /// - Returns: The cached image, or `nil`.
  public func image(forKey key: String) -> EmoteImage? {
    state.withLock { state in
      guard var entry = state.entries[key] else {
        return nil
      }

      state.clock += 1
      entry.lastUse = state.clock
      state.entries[key] = entry
      return entry.image
    }
  }

  /// Stores an image, then drops the least recently used images beyond ``costLimit``.
  ///
  /// An image larger than the whole limit is not stored.
  ///
  /// - Parameters:
  ///   - image: The decoded image.
  ///   - key: The cache key.
  public func insert(_ image: EmoteImage, forKey key: String) {
    let cost = Self.cost(of: image)
    guard cost <= costLimit else {
      return
    }

    state.withLock { state in
      state.clock += 1
      if let old = state.entries.updateValue(
        Entry(image: image, cost: cost, lastUse: state.clock),
        forKey: key
      ) {
        state.totalCost -= old.cost
      }
      state.totalCost += cost
      while state.totalCost > costLimit {
        guard let oldest = state.entries.min(by: { $0.value.lastUse < $1.value.lastUse }) else {
          break
        }

        state.entries.removeValue(forKey: oldest.key)
        state.totalCost -= oldest.value.cost
      }
    }
  }

  /// Removes every image.
  public func removeAll() {
    state.withLock { $0 = State() }
  }
}
