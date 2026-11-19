@testable import BotgeKit
import Foundation
import Testing

struct GameClientTests {
  private static let base: URL? = URL(string: "https://botge.example.com/botge-api/app/v1")

  private static func api(_ transport: StubTransport) throws -> BotgeAPI {
    let store = MemorySecretStore()
    let tokens = OAuthTokens(
      accessToken: "t",
      refreshToken: nil,
      expiresAt: .distantFuture,
      scope: "identify"
    )
    try store.write(JSONEncoder().encode(tokens), for: AuthSession.tokenKey)
    let oauth = DiscordOAuth(applicationID: "123456789012345678")
    let session = AuthSession(oauth: oauth, transport: transport, store: store)
    return try BotgeAPI(baseURL: #require(base), session: session, transport: transport)
  }

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
    let client = try GameClient(api: Self.api(transport), connector: connector)
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
    let client = try GameClient(api: Self.api(transport), connector: connector)
    await #expect(throws: APIError.permissionDenied("Not a member.")) {
      try await client.join(#require(GameRoomCode("AB")), guild: "1")
    }
    #expect(connector.urls.isEmpty)
  }

  @Test
  func `round image URLs accept only token characters`() throws {
    let client = try GameClient(api: Self.api(StubTransport([])), connector: ScriptedConnector([]))
    #expect(client.imageURL(for: "a-B_9")?.absoluteString
      == "https://botge.example.com/botge-api/app/v1/game/image/a-B_9")
    for bad in ["", "../x", "a b", "a?b"] {
      #expect(client.imageURL(for: bad) == nil)
    }
  }
}
