@testable import BotgeKit
import Foundation
import Testing

struct GameClientTests {
  private static func object(_ text: String?) throws -> [String: String] {
    let data = try #require(text.map { Data($0.utf8) })
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
  }

  @Test
  func `joining issues a ticket, presents it and relays room messages`() async throws {
    let transport = StubTransport([StubTransport.json(200, ["ticket": "T1", "userId": "42"])])
    let socket = ScriptedSocket([
      "not json",
      #"{"type":"mystery"}"#,
      #"{"type":"wrong"}"#
    ])
    let connector = ScriptedConnector([socket])
    let client = try GameClient(api: TestAPI.signedIn(transport), connector: connector)
    let room = try #require(GameRoomCode("K7QF2M"))

    let connection = try await client.join(room, guild: "1")
    #expect(connection.userID == "42")
    #expect(connector.urls
      .map(\.absoluteString) == ["wss://botge.example.com/botge-api/app/v1/game/ws"])
    let body = try #require(transport.requests.first?.httpBody)
    let request = try #require(JSONSerialization.jsonObject(with: body) as? [String: String])
    #expect(request == ["guildId": "1", "instanceId": "app-K7QF2M"])
    #expect(try Self.object(socket.sent.first) == ["type": "join", "ticket": "T1"])

    #expect(try await connection.receive() == .wrong)
    await #expect(throws: APIError.network) { try await connection.receive() }

    try await connection.send(.start)
    try await connection.send(.guess("catJAM"))
    try await connection.send(.guess(String(repeating: "a", count: GameCommand.maxGuessBytes + 1)))
    #expect(try socket.sent.dropFirst().map(Self.object) == [
      ["type": "start"],
      ["type": "guess", "text": "catJAM"]
    ])
    connection.close()
    #expect(socket.isClosed)
  }

  @Test
  func `a refused ticket opens no connection`() async throws {
    let transport = StubTransport([StubTransport.json(403, ["message": "Not a member."])])
    let connector = ScriptedConnector([])
    let client = try GameClient(api: TestAPI.signedIn(transport), connector: connector)
    await #expect(throws: APIError.permissionDenied("Not a member.")) {
      try await client.join(#require(GameRoomCode("AB")), guild: "1")
    }
    #expect(connector.urls.isEmpty)
  }

  @Test
  func `round image URLs accept only token characters`() throws {
    let client = try GameClient(
      api: TestAPI.signedIn(StubTransport([])),
      connector: ScriptedConnector([])
    )
    #expect(client.imageURL(for: "a-B_9")?.absoluteString
      == "https://botge.example.com/botge-api/app/v1/game/image/a-B_9")
    for bad in ["", "../x", "a b", "a?b"] {
      #expect(client.imageURL(for: bad) == nil)
    }
  }

  @Test
  func `a connection that refuses the ticket is closed`() async throws {
    let transport = StubTransport([StubTransport.json(200, ["ticket": "T1", "userId": "42"])])
    let socket = ScriptedSocket([], failsToSend: true)
    let client = try GameClient(
      api: TestAPI.signedIn(transport),
      connector: ScriptedConnector([socket])
    )
    await #expect(throws: APIError.network) {
      try await client.join(#require(GameRoomCode("AB")), guild: "1")
    }
    #expect(socket.isClosed)
  }

  @Test
  func `commands on a closed connection fail`() async {
    let closed = GameConnection(userID: "42", socket: ScriptedSocket([], failsToSend: true))
    await #expect(throws: APIError.network) {
      try await closed.send(.start)
    }
  }
}
