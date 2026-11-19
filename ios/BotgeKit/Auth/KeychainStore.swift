public import Foundation
import Security

/// Generic-password Keychain items for one service, readable only on this device after the first
/// unlock and never synced to iCloud or included in backups.
public struct KeychainStore: SecretStore {
  private let service: String

  /// Creates a store whose items share the `service` attribute.
  public init(service: String) {
    self.service = service
  }

  /// Reads the item for `key`.
  ///
  /// - Returns: The stored bytes, or `nil` when there are none.
  /// - Throws: ``SecretStoreError`` for any status other than success or item-not-found.
  public func read(_ key: String) throws(SecretStoreError) -> Data? {
    var query = baseQuery(key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    switch status {
    case errSecSuccess:
      return result as? Data

    case errSecItemNotFound:
      return nil

    default:
      throw SecretStoreError(status: status)
    }
  }

  /// Adds or updates the item for `key`.
  ///
  /// - Parameters:
  ///   - value: The bytes to store.
  ///   - key: The account name.
  /// - Throws: ``SecretStoreError`` when the Keychain rejects the write.
  public func write(_ value: Data, for key: String) throws(SecretStoreError) {
    let attributes: [String: Any] = [
      kSecValueData as String: value,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]
    let status = SecItemUpdate(baseQuery(key) as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      let added = baseQuery(key).merging(attributes) { _, new in new }
      let addStatus = SecItemAdd(added as CFDictionary, nil)
      guard addStatus == errSecSuccess else {
        throw SecretStoreError(status: addStatus)
      }
    } else if status != errSecSuccess {
      throw SecretStoreError(status: status)
    }
  }

  /// Deletes the item for `key`.
  ///
  /// - Throws: ``SecretStoreError`` for any status other than success or item-not-found.
  public func delete(_ key: String) throws(SecretStoreError) {
    let status = SecItemDelete(baseQuery(key) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw SecretStoreError(status: status)
    }
  }

  private func baseQuery(_ key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrSynchronizable as String: false,
      kSecUseDataProtectionKeychain as String: true
    ]
  }
}
