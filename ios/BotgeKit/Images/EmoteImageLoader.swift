import Foundation

/// Downloads and decodes emote images, degrading instead of failing.
///
/// For each candidate URL (Lockdown-safe formats first) the loader tries a full decode, then the
/// first frame only, then the next candidate. When every candidate fails it returns
/// ``EmoteImage/placeholder`` so the grid never shows a broken or blank tile.
///
/// Downloads and decodes run in parallel off the actor, and concurrent requests for the same
/// image share one load. Results go to ``memory``, which views read synchronously.
public actor EmoteImageLoader {
  /// Decoded bytes kept in memory by default: roughly 150 animated emotes at grid size.
  public static let defaultCostLimit = 192 << 20

  /// Decoded images, shared with views for synchronous reads.
  public nonisolated let memory: EmoteImageCache
  /// Downloads image bytes, with disk caching by `URLCache`.
  private let transport: any HTTPTransport
  /// Turns bytes into frames.
  private let decoder: any ImageDecoding
  /// Loads in progress by cache key, so repeated requests wait for the same result.
  private var inFlight: [String: Task<EmoteImage, Never>] = [:]

  /// Creates a loader; responses are also cached on disk by the transport's `URLCache`.
  ///
  /// - Parameters:
  ///   - transport: Downloads image bytes.
  ///   - decoder: Decodes them.
  ///   - costLimit: Decoded bytes kept in memory.
  public init(
    transport: any HTTPTransport,
    decoder: any ImageDecoding = ImageIODecoder(),
    costLimit: Int = defaultCostLimit
  ) {
    self.transport = transport
    self.decoder = decoder
    memory = EmoteImageCache(costLimit: costLimit)
  }

  /// The cache key for one path and decode mode.
  ///
  /// - Parameters:
  ///   - path: The catalog image path.
  ///   - animated: Whether every frame is decoded.
  /// - Returns: The key in ``memory``.
  static func key(for path: String, animated: Bool) -> String {
    "\(animated ? "a" : "s")|\(path)"
  }

  /// Tries each candidate in order and returns the best result.
  ///
  /// Runs on the concurrent executor so decoding never blocks the actor.
  ///
  /// - Parameters:
  ///   - candidates: URLs in preference order.
  ///   - animated: Whether to decode every frame.
  ///   - transport: Downloads image bytes.
  ///   - decoder: Decodes them.
  /// - Returns: The first decodable image, or a placeholder.
  @concurrent
  static func load(
    _ candidates: [URL],
    animated: Bool,
    transport: any HTTPTransport,
    decoder: any ImageDecoding
  )
    async -> EmoteImage
  {
    for url in candidates {
      guard let (data, response) = try? await transport.data(for: URLRequest(url: url)),
            let status = (response as? HTTPURLResponse)?.statusCode,
            HTTPStatus.success.contains(status)
      else {
        continue
      }

      if animated, let image = try? decoder.decodeFrames(data) {
        return image
      }
      if let frame = try? decoder.decodeFirstFrame(data) {
        return .still(frame)
      }
    }
    return .placeholder
  }

  /// The decoded image for `path` if it is already in memory.
  ///
  /// - Parameters:
  ///   - path: The catalog image path.
  ///   - animated: Whether every frame was decoded.
  /// - Returns: The cached image, or `nil`.
  public nonisolated func cachedImage(for path: String, animated: Bool) -> EmoteImage? {
    memory.image(forKey: Self.key(for: path, animated: animated))
  }

  /// Loads the image for a catalog path such as `/7tv-cdn/emote/ID/2x.webp`.
  ///
  /// A still load decodes only the first frame, which is much faster than a full animation, so
  /// views load it first and then the animation. Placeholders are not cached, so a later call
  /// retries the download.
  ///
  /// - Parameters:
  ///   - path: The catalog image path.
  ///   - animated: Whether to decode every frame.
  /// - Returns: The image, a still frame, or a placeholder.
  public func image(for path: String, animated: Bool) async -> EmoteImage {
    let key = Self.key(for: path, animated: animated)
    if let cached = memory.image(forKey: key) {
      return cached
    }
    if let running = inFlight[key] {
      return await running.value
    }

    let task = Task { [transport, decoder] in
      await Self.load(
        EmoteImageURL.candidates(for: path),
        animated: animated,
        transport: transport,
        decoder: decoder
      )
    }
    inFlight[key] = task
    let image = await task.value
    inFlight[key] = nil
    if case .placeholder = image {
      return image
    }

    memory.insert(image, forKey: key)
    return image
  }

  /// Removes decoded images from memory; the disk cache is cleared through `URLCache`.
  public func clearMemory() {
    memory.removeAll()
  }
}
