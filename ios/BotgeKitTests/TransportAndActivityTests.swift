@testable import BotgeKit
import Foundation
import Testing

struct TransportAndActivityTests {
  @Test
  func `URLSession conforms to HTTPTransport`() async throws {
    let file = FileManager.default.temporaryDirectory.appending(path: "botge-\(UUID().uuidString)")
    try Data("hello".utf8).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    let transport: any HTTPTransport = URLSession(configuration: .ephemeral)
    let (data, _) = try await transport.data(for: URLRequest(url: file))
    #expect(data == Data("hello".utf8))
  }

  @Test
  func `the Guess Live Activity state round trips through Codable`() throws {
    let attributes = GuessActivityAttributes(serverName: "Botge", rounds: 10)
    let state = GuessActivityAttributes.ContentState(
      round: 2,
      roundEndsAt: Date(timeIntervalSince1970: 1_000),
      score: 300,
      rank: 1
    )
    let decoded = try JSONDecoder().decode(
      GuessActivityAttributes.ContentState.self,
      from: JSONEncoder().encode(state)
    )
    #expect(decoded == state)
    #expect(attributes.serverName == "Botge")
    #expect(attributes.rounds == 10)
  }
}
