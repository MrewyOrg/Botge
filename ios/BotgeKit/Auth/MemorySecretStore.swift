public import Foundation
import Synchronization

/// Keeps secrets in memory only; used by tests and UI-test fixtures, never for real tokens.
public final class MemorySecretStore: SecretStore {
  private let values: Mutex<[String: Data]> = .init([:])

  /// Creates an empty store.
  public init() {
    // Starts empty; values exist only for the lifetime of this object.
  }

  deinit {
    // Values are released with the store; nothing is persisted.
  }

  /// Returns the stored value.
  public func read(_ key: String) -> Data? {
    values.withLock { $0[key] }
  }

  /// Stores or replaces the value.
  public func write(_ value: Data, for key: String) {
    values.withLock { $0[key] = value }
  }

  /// Removes the value.
  public func delete(_ key: String) {
    _ = values.withLock { $0.removeValue(forKey: key) }
  }
}
