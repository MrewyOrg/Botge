import Foundation
import Security

/// The Security framework calls ``KeychainStore`` makes; tests replace them to simulate failures.
struct KeychainCalls {
  /// The Keychain itself.
  static let system: Self = .init(
    copyMatching: SecItemCopyMatching,
    update: SecItemUpdate,
    add: SecItemAdd,
    delete: SecItemDelete
  )

  /// Finds an item, as `SecItemCopyMatching`.
  let copyMatching: @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
  /// Changes an item, as `SecItemUpdate`.
  let update: @Sendable (CFDictionary, CFDictionary) -> OSStatus
  /// Adds an item, as `SecItemAdd`.
  let add: @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
  /// Deletes an item, as `SecItemDelete`.
  let delete: @Sendable (CFDictionary) -> OSStatus
}
