public import CoreGraphics
import Foundation

/// A thread-safe cache of decoded emotes, bounded by decoded bytes.
///
/// Views read it synchronously while they render, so an emote scrolled back into view shows at
/// once instead of waiting for the loader. It is an `NSCache`, so the system also evicts images
/// when memory runs low. Animated emotes cost far more than still ones, so the bound is in bytes
/// rather than entries.
public final class EmoteImageCache: @unchecked Sendable {
  /// Wraps an image for `NSCache`, which stores objects.
  private final class Box {
    /// The decoded image.
    let image: EmoteImage

    /// Wraps `image`.
    ///
    /// - Parameter image: The decoded image.
    init(_ image: EmoteImage) {
      self.image = image
    }

    deinit {
      // The image is released with the box.
    }
  }

  /// A cache key; `NSCache` compares keys with `isEqual(_:)` and `hash`.
  private final class Key: NSObject {
    /// The key text.
    let text: String

    override var hash: Int {
      text.hashValue
    }

    /// Wraps `text`.
    ///
    /// - Parameter text: The key text.
    init(_ text: String) {
      self.text = text
    }

    deinit {
      // The text is released with the key.
    }

    override func isEqual(_ object: Any?) -> Bool {
      (object as? Self)?.text == text
    }
  }

  /// Bytes kept at most; `NSCache` evicts images beyond it.
  public let costLimit: Int
  /// The images; `NSCache` is safe to use from any thread.
  private let images: NSCache<Key, Box> = .init()

  /// Creates an empty cache.
  ///
  /// - Parameter costLimit: Decoded bytes kept at most.
  public init(costLimit: Int) {
    self.costLimit = costLimit
    images.totalCostLimit = costLimit
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

  /// Returns the image for `key`.
  ///
  /// - Parameter key: The cache key.
  /// - Returns: The cached image, or `nil`.
  public func image(forKey key: String) -> EmoteImage? {
    images.object(forKey: Key(key))?.image
  }

  /// Stores an image; an image larger than the whole limit is not stored.
  ///
  /// - Parameters:
  ///   - image: The decoded image.
  ///   - key: The cache key.
  public func insert(_ image: EmoteImage, forKey key: String) {
    let cost = Self.cost(of: image)
    guard cost <= costLimit else {
      return
    }

    images.setObject(Box(image), forKey: Key(key), cost: cost)
  }

  /// Removes every image.
  public func removeAll() {
    images.removeAllObjects()
  }
}
