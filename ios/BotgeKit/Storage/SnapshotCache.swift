public import Foundation

/// Keeps the last loaded emote lists on disk, so the app can show them at once on the next
/// launch while it refreshes them.
///
/// Snapshots live in the app's Caches folder, which iOS may clear when space runs low and
/// which is not backed up. A missing, unreadable or outdated snapshot reads as `nil`.
public struct SnapshotCache: Sendable {
  /// The folder holding one JSON file per key.
  let directory: URL

  /// Creates a cache in `directory`, which is created on the first write.
  ///
  /// - Parameter directory: The folder for the snapshot files.
  public init(directory: URL) {
    self.directory = directory
  }

  /// The default cache in the app's Caches folder.
  ///
  /// - Returns: A cache under `Caches/Snapshots`.
  public static func standard() -> Self {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return Self(directory: caches.appending(path: "Snapshots", directoryHint: .isDirectory))
  }

  /// Reads the snapshot stored under `key`.
  ///
  /// - Parameters:
  ///   - type: The stored type.
  ///   - key: The snapshot name.
  /// - Returns: The value, or `nil` when there is none or it cannot be decoded.
  @concurrent
  public func read<Value: Decodable & Sendable>(_ type: Value.Type, key: String) async -> Value? {
    guard let url = file(for: key), let data = try? Data(contentsOf: url) else {
      return nil
    }

    return try? JSONDecoder().decode(type, from: data)
  }

  /// Replaces the snapshot stored under `key`; failures are ignored, since the cache is only
  /// a head start.
  ///
  /// - Parameters:
  ///   - value: The value to store.
  ///   - key: The snapshot name.
  @concurrent
  public func write(_ value: some Encodable & Sendable, key: String) async {
    guard let url = file(for: key), let data = try? JSONEncoder().encode(value) else {
      return
    }

    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? data.write(
      to: url,
      options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
    )
  }

  /// Deletes every snapshot, for logout and Clear Cache.
  @concurrent
  public func removeAll() async {
    try? FileManager.default.removeItem(at: directory)
  }

  /// The file for `key`, or `nil` when the key has characters a file name should not.
  ///
  /// - Parameter key: The snapshot name.
  /// - Returns: The file URL.
  func file(for key: String) -> URL? {
    guard !key.isEmpty, key.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") })
    else {
      return nil
    }

    return directory.appending(path: "\(key).json")
  }
}
