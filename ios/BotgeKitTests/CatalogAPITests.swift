@testable import BotgeKit
import Foundation
import Testing

struct CatalogAPITests {
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

  private static func body(_ request: URLRequest?) throws -> [String: String] {
    let data = try #require(request?.httpBody)
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    return (object ?? [:]).compactMapValues { value in
      (value as? String) ?? (value as? [String])?.joined(separator: ",")
    }
  }

  @Test
  func `catalog, add and remove post the Activity's JSON fields`() async throws {
    let catalog = StubTransport.Reply.response(
      status: 200,
      body: Data(#"{"message":"m","emotes":[],"canManageEmotes":false,"canComposeDiscovery":true}"#
        .utf8)
    )
    let transport = StubTransport([
      catalog,
      StubTransport.json(201, ["message": "Added peepoHey.", "added": true]),
      StubTransport.json(200, ["message": "Removed emote.", "removed": true])
    ])
    let api = try Self.api(transport)
    #expect(try await api.catalog(guild: "1").canComposeDiscovery)
    #expect(try await api.addEmote(guild: "1", sevenTVID: "A") == "Added peepoHey.")
    #expect(try await api.removeEmote(guild: "1", sevenTVID: "A") == "Removed emote.")
    let paths = transport.requests.compactMap { $0.url?.path() }
    #expect(paths == [
      "/botge-api/app/v1/catalog",
      "/botge-api/app/v1/emotes",
      "/botge-api/app/v1/emotes/remove"
    ])
    #expect(try Self.body(transport.requests.first) == ["guildId": "1"])
    #expect(try Self.body(transport.requests.last) == ["guildId": "1", "emoteId": "A"])
  }

  @Test
  func `batches validate their size and decode one result per item`() async throws {
    let results = StubTransport.Reply.response(
      status: 200,
      body: Data(
        (#"[{"emoteId":"A","ok":true,"message":"Added."},"#
          + #"{"emoteId":"B","ok":false,"message":"Taken."}]"#).utf8
      )
    )
    let transport = StubTransport([results])
    let api = try Self.api(transport)
    let changes = try await api.changeEmotes(guild: "1", action: .add, sevenTVIDs: ["A", "B"])
    #expect(changes.map(\.succeeded) == [true, false])
    #expect(changes.last?.emoteID == "B")
    #expect(try Self.body(transport.requests.first) == [
      "guildId": "1",
      "action": "add",
      "emoteIds": "A,B"
    ])

    for ids in [[], ["A", "A"], (0 ... BotgeAPI.maxBatch).map(String.init)] {
      await #expect(throws: APIError.self) {
        try await api.changeEmotes(guild: "1", action: .remove, sevenTVIDs: ids)
      }
    }
    #expect(transport.requests.count == 1)
  }

  @Test
  func `socket URLs switch to WebSocket schemes`() async throws {
    let secure = try Self.api(StubTransport([]))
    #expect(await secure.socketURL("catalog/ws")?
      .absoluteString == "wss://botge.example.com/botge-api/app/v1/catalog/ws")
    let store = MemorySecretStore()
    let oauth = DiscordOAuth(applicationID: "123456789012345678")
    let session = AuthSession(oauth: oauth, transport: StubTransport([]), store: store)
    let local = try BotgeAPI(
      baseURL: #require(URL(string: "http://127.0.0.1:3080/app/v1")),
      session: session,
      transport: StubTransport([])
    )
    #expect(await local.socketURL("game/ws")?
      .absoluteString == "ws://127.0.0.1:3080/app/v1/game/ws")
  }
}
