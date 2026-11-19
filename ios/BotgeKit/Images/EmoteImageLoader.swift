import Foundation

/// Downloads and decodes emote images, degrading instead of failing.
///
/// For each candidate URL (Lockdown-safe formats first) the loader tries a full decode, then the
/// first frame only, then the next candidate. When every candidate fails it returns
/// ``EmoteImage/placeholder`` so the grid never shows a broken or blank tile.
public actor EmoteImageLoader {
  /// Decoded images kept in memory; the oldest entry is dropped beyond this count.
  public static let memoryLimit = 512

  /// Downloads image bytes, with disk caching by `URLCache`.
  private let transport: any HTTPTransport
  /// Turns bytes into frames.
  private let decoder: any ImageDecoding
  /// Decoded images by `animated|path` key.
  private var memory: [String: EmoteImage] = [:]
  /// Keys of ``memory`` from oldest to newest, for eviction.
  private var order: [String] = []

  /// Creates a loader; responses are also cached on disk by the transport's `URLCache`.
  ///
  /// - Parameters:
  ///   - transport: Downloads image bytes.
  ///   - decoder: Decodes them.
  public init(transport: any HTTPTransport, decoder: any ImageDecoding = ImageIODecoder()) {
    self.transport = transport
    self.decoder = decoder
  }

  /// Loads the image for a catalog path such as `/7tv-cdn/emote/ID/2x.webp`.
  ///
  /// Placeholders are not cached, so a later call retries the download.
  ///
  /// - Parameters:
  ///   - path: The catalog image path.
  ///   - animated: Whether to decode every frame.
  /// - Returns: The image, a still frame, or a placeholder.
  public func image(for path: String, animated: Bool) async -> EmoteImage {
    let key = "\(animated ? "a" : "s")|\(path)"
    if let cached = memory[key] {
      return cached
    }

    let image = await load(EmoteImageURL.candidates(for: path), animated: animated)
    if case .placeholder = image {
      return image
    }

    remember(image, for: key)
    return image
  }

  /// Removes decoded images from memory; the disk cache is cleared through `URLCache`.
  public func clearMemory() {
    memory.removeAll()
    order.removeAll()
  }

  /// Tries each candidate in order and returns the best result.
  ///
  /// - Parameters:
  ///   - candidates: URLs in preference order.
  ///   - animated: Whether to decode every frame.
  /// - Returns: The first decodable image, or a placeholder.
  func load(_ candidates: [URL], animated: Bool) async -> EmoteImage {
    for url in candidates {
      guard let (data, response) = try? await transport.data(for: URLRequest(url: url)),
            let status = (response as? HTTPURLResponse)?.statusCode,
            HTTPStatus.success.contains(status)
      else {
        continue
      }

      if let image = decode(data, animated: animated) {
        return image
      }
    }
    return .placeholder
  }

  /// Decodes all frames when animating, else or on failure the first frame.
  ///
  /// - Parameters:
  ///   - data: Downloaded image bytes.
  ///   - animated: Whether to decode every frame.
  /// - Returns: The image, or `nil` when nothing decodes.
  private func decode(_ data: Data, animated: Bool) -> EmoteImage? {
    if animated, let image = try? decoder.decodeFrames(data) {
      return image
    }

    return (try? decoder.decodeFirstFrame(data)).map(EmoteImage.still)
  }

  /// Caches an image and evicts the oldest beyond ``memoryLimit``.
  ///
  /// - Parameters:
  ///   - image: The decoded image.
  ///   - key: Its cache key.
  private func remember(_ image: EmoteImage, for key: String) {
    if memory.updateValue(image, forKey: key) == nil {
      order.append(key)
    }
    while order.count > Self.memoryLimit {
      memory.removeValue(forKey: order.removeFirst())
    }
  }
}
