@testable import BotgeKit
import Foundation
import Testing

struct URLSessionSocketTests {
  @Test
  func `URLSession sockets exchange text and binary frames`() async throws {
    let server = try LoopbackWebSocketServer()
    await server.start()
    let url = try #require(server.url)
    let session = URLSession(configuration: .ephemeral)
    let socket = session.connect(to: url)
    try await socket.send("hello")
    #expect(try await socket.receive() == "hello")
    #expect(try await socket.receive() == "hello")
    socket.close()
    await #expect(throws: (any Error).self) {
      try await socket.receive()
    }
  }

  @Test
  func `catalogs can be built directly`() {
    let catalog = Catalog(emotes: [], canManageEmotes: true, canComposeDiscovery: false)
    #expect(catalog.emotes.isEmpty && catalog.canManageEmotes && !catalog.canComposeDiscovery)
  }
}
