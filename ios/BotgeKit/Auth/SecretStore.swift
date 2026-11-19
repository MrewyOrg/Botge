public import Foundation

/// Stores small secrets by key; ``KeychainStore`` is the production implementation.
public protocol SecretStore: Sendable {
  /// Returns the stored value, or `nil` when the key has none.
  ///
  /// - Throws: ``SecretStoreError`` when the store cannot be read.
  func read(_ key: String) throws(SecretStoreError) -> Data?

  /// Stores or replaces the value for `key`.
  ///
  /// - Throws: ``SecretStoreError`` when the store cannot be written.
  func write(_ value: Data, for key: String) throws(SecretStoreError)

  /// Removes the value for `key`; removing a missing key succeeds.
  ///
  /// - Throws: ``SecretStoreError`` when the store cannot be written.
  func delete(_ key: String) throws(SecretStoreError)
}
