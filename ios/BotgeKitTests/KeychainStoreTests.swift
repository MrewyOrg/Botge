@testable import BotgeKit
import Foundation
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
}
