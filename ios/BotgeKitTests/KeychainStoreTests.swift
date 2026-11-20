@testable import BotgeKit
import Foundation
import Security
import Testing

@Suite(.serialized)
struct KeychainStoreTests {
  private let store: KeychainStore = .init(service: "BotgeKitTests.\(UUID().uuidString)")

  @Test
  func `values round trip, update, and delete`() throws {
    #expect(try store.read("k") == nil)
    try store.write(Data("one".utf8), for: "k")
    try store.write(Data("two".utf8), for: "k")
    #expect(try store.read("k") == Data("two".utf8))
    try store.delete("k")
    try store.delete("k")
    #expect(try store.read("k") == nil)
  }

  @Test
  func `errors carry the Security status`() {
    #expect(SecretStoreError(status: -25_300).status == -25_300)
  }

  @Test
  func `failed Keychain calls report their status`() {
    let failing = KeychainCalls(
      copyMatching: { _, _ in errSecInteractionNotAllowed },
      update: { _, _ in errSecItemNotFound },
      add: { _, _ in errSecDuplicateItem },
      delete: { _ in errSecInteractionNotAllowed }
    )
    let broken = KeychainStore(service: "BotgeKitTests.failing", calls: failing)
    #expect(throws: SecretStoreError(status: errSecInteractionNotAllowed)) {
      try broken.read("k")
    }
    #expect(throws: SecretStoreError(status: errSecDuplicateItem)) {
      try broken.write(Data(), for: "k")
    }
    #expect(throws: SecretStoreError(status: errSecInteractionNotAllowed)) {
      try broken.delete("k")
    }
  }

  @Test
  func `rejected updates are reported without adding`() {
    let rejecting = KeychainCalls(
      copyMatching: { _, _ in errSecItemNotFound },
      update: { _, _ in errSecAuthFailed },
      add: { _, _ in errSecSuccess },
      delete: { _ in errSecSuccess }
    )
    let locked = KeychainStore(service: "BotgeKitTests.rejecting", calls: rejecting)
    #expect(throws: SecretStoreError(status: errSecAuthFailed)) {
      try locked.write(Data(), for: "k")
    }
  }
}
