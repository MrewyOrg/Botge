public import Foundation

/// Downloads and decodes emote images, degrading instead of failing.
///
/// The loader downloads ``EmoteImageURL/requestURL(for:)`` and tries a full decode, then the first
/// frame only. When both fail it returns ``EmoteImage/placeholder`` so the grid never shows a
/// broken or blank tile.
///
/// Downloads and decodes run in parallel off the actor at the caller's priority, and concurrent
/// requests for the same image share one load, which is cancelled once nobody waits for it.
/// Downloads come from the disk cache when possible. Results go to ``memory``, which views read
/// synchronously.
public actor EmoteImageLoader {
  /// Decoded bytes kept in memory by default: roughly 75 animated emotes at grid size.
  public static let defaultCostLimit = 96 << 20

  /// Decoded images, shared with views for synchronous reads.
  public nonisolated let memory: EmoteImageCache
  /// Downloads image bytes, with disk caching by `URLCache`.
  private let transport: any HTTPTransport
  /// Turns bytes into frames.
  private let decoder: any ImageDecoding
  /// Loads in progress by cache key, so repeated requests wait for the same result.
  private var inFlight: [String: Task<EmoteImage, Never>] = [:]
  /// Requests waiting on each load, and how many of them were cancelled.
  private var waiters: [String: (total: Int, cancelled: Int)] = [:]

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

  /// Downloads and decodes one image.
  ///
  /// Runs on the concurrent executor so decoding never blocks the actor.
  ///
  /// - Parameters:
  ///   - url: The image URL, or `nil` when the path was refused.
  ///   - animated: Whether to decode every frame.
  ///   - transport: Downloads image bytes.
  ///   - decoder: Decodes them.
  /// - Returns: The image, its first frame, or a placeholder.
  @concurrent
  static func load(
    _ url: URL?,
    animated: Bool,
    transport: any HTTPTransport,
    decoder: any ImageDecoding
  )
    async -> EmoteImage
  {
    guard let url, !Task.isCancelled,
          let (data, response) = try? await transport.data(
            // Image URLs never change content; Botge's round images are never stored.
            for: URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad)
          ),
          let status = (response as? HTTPURLResponse)?.statusCode,
          HTTPStatus.success.contains(status)
    else {
      return .placeholder
    }

    if animated, let image = try? decoder.decodeFrames(data) {
      return image
    }

    return (try? decoder.decodeFirstFrame(data)).map(EmoteImage.still) ?? .placeholder
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

  /// Loads the image for a load path such as `/7tv-cdn/emote/ID/2x.gif`.
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
    let task = inFlight[key] ?? start(path: path, animated: animated, key: key)
    waiters[key, default: (0, 0)].total += 1
    let image = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      Task { await self.abandon(key, task: task) }
    }
    finish(key, task: task)
    if case .placeholder = image {
      return image
    }

    memory.insert(image, forKey: key)
    return image
  }

  /// Starts loading `path` with the caller's priority.
  ///
  /// Emote URLs never change their content, so a response already in the disk cache is used
  /// without asking the CDN again.
  ///
  /// - Parameters:
  ///   - path: The catalog image path.
  ///   - animated: Whether to decode every frame.
  ///   - key: The cache key.
  /// - Returns: The running load.
  private func start(path: String, animated: Bool, key: String) -> Task<EmoteImage, Never> {
    let task = Task { [transport, decoder] in
      await Self.load(
        EmoteImageURL.requestURL(for: path),
        animated: animated,
        transport: transport,
        decoder: decoder
      )
    }
    inFlight[key] = task
    return task
  }

  /// Notes that one request stopped waiting; once every request has, the load is cancelled, so
  /// tiles scrolled off screen stop taking bandwidth from visible ones.
  ///
  /// - Parameters:
  ///   - key: The cache key.
  ///   - task: The load the request waited on.
  private func abandon(_ key: String, task: Task<EmoteImage, Never>) {
    guard inFlight[key] == task, var waiting = waiters[key] else {
      return
    }

    waiting.cancelled += 1
    waiters[key] = waiting
    if waiting.cancelled >= waiting.total {
      task.cancel()
      // Later requests start a fresh load instead of receiving the cancelled one's placeholder.
      inFlight[key] = nil
      waiters[key] = nil
    }
  }

  /// Notes that one request received its result.
  ///
  /// - Parameters:
  ///   - key: The cache key.
  ///   - task: The load the request waited on.
  private func finish(_ key: String, task: Task<EmoteImage, Never>) {
    guard inFlight[key] == task, var waiting = waiters[key] else {
      return
    }

    waiting.total -= 1
    if waiting.total < 1 {
      inFlight[key] = nil
      waiters[key] = nil
    } else {
      waiters[key] = waiting
    }
  }

  /// Loads a Guess round image from Botge, decoding every frame.
  ///
  /// Round images change every round, so they are not kept in ``memory``.
  ///
  /// - Parameter url: The round image URL from ``GameClient/imageURL(for:)``.
  /// - Returns: The image, a still frame, or a placeholder.
  public func roundImage(at url: URL) async -> EmoteImage {
    await Self.load(url, animated: true, transport: transport, decoder: decoder)
  }

  /// Removes decoded images from memory; the disk cache is cleared through `URLCache`.
  public func clearMemory() {
    memory.removeAll()
  }
}
