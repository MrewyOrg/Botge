@testable import BotgeKit
import Foundation
import Testing

struct BotgeAPITests {
  private static let base: URL? = URL(string: "https://botge.example.com/botge-api/app/v1")
  private static let oauth: DiscordOAuth = .init(applicationID: "123456789012345678")
  private static let guildList = StubTransport.Reply.response(
    status: 200,
    body: Data(#"{"guilds":[{"id":"1","name":"Botge","icon":null,"administrator":true}]}"#.utf8)
  )

  private static func signedIn(_ transport: StubTransport) throws -> BotgeAPI {
    let store = MemorySecretStore()
    let tokens = OAuthTokens(
      accessToken: "first",
      refreshToken: "refresh",
      expiresAt: .distantFuture,
      scope: "identify"
    )
    try store.write(JSONEncoder().encode(tokens), for: AuthSession.tokenKey)
    let session = AuthSession(oauth: oauth, transport: transport, store: store)
    return try BotgeAPI(baseURL: #require(base), session: session, transport: transport)
  }

  @Test
  func `guilds are posted with the bearer token and decoded`() async throws {
    let transport = StubTransport([Self.guildList])
    let guilds = try await Self.signedIn(transport).guilds()
    #expect(guilds == [SharedGuild(id: "1", name: "Botge", icon: nil, administrator: true)])
    let request = try #require(transport.requests.first)
    #expect(request.url?.absoluteString == "https://botge.example.com/botge-api/app/v1/guilds")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer first")
  }

  @Test
  func `an expired token is renewed once and the request retried`() async throws {
    let transport = StubTransport([
      StubTransport.json(401, ["message": "expired", "code": "oauth_expired"]),
      StubTransport.json(200, [
        "access_token": "second",
        "token_type": "Bearer",
        "expires_in": 600,
        "scope": "identify"
      ]),
      Self.guildList
    ])
    let guilds = try await Self.signedIn(transport).guilds()
    #expect(guilds.count == 1)
    #expect(transport.requests.last?.value(forHTTPHeaderField: "Authorization") == "Bearer second")
  }

  @Test
  func `a second rejection or a plain 401 signs the user out`() async throws {
    let expired = StubTransport.json(401, ["message": "expired", "code": "oauth_expired"])
    let renewed = StubTransport.json(200, [
      "access_token": "second",
      "token_type": "Bearer",
      "expires_in": 600,
      "scope": "identify"
    ])
    let twice = StubTransport([expired, renewed, expired])
    await #expect(throws: APIError.signedOut) {
      try await Self.signedIn(twice).guilds()
    }
    let plain = StubTransport([StubTransport.json(401, ["message": "no"])])
    await #expect(throws: APIError.signedOut) {
      try await Self.signedIn(plain).guilds()
    }
  }

  @Test
  func `failed renewals and transport errors are reported`() async throws {
    let expired = StubTransport.json(401, ["message": "expired", "code": "oauth_expired"])
    let rejectedRefresh = StubTransport([
      expired,
      StubTransport.json(400, ["error": "invalid_grant"])
    ])
    await #expect(throws: APIError.signedOut) {
      try await Self.signedIn(rejectedRefresh).guilds()
    }
    let offlineRefresh = StubTransport([expired, .failure(.notConnectedToInternet)])
    await #expect(throws: APIError.network) {
      try await Self.signedIn(offlineRefresh).guilds()
    }
    let offline = StubTransport([.failure(.timedOut)])
    await #expect(throws: APIError.network) {
      try await Self.signedIn(offline).guilds()
    }
  }

  @Test(arguments: [
    (403, APIError.permissionDenied("m")),
    (404, APIError.notFound("m")),
    (429, APIError.busy("m")),
    (503, APIError.busy("m")),
    (400, APIError.rejected("m")),
    (502, APIError.unavailable("m"))
  ])
  func `error statuses map to user-facing cases`(status: Int, expected: APIError) async throws {
    let transport = StubTransport([StubTransport.json(status, ["message": "m"])])
    await #expect(throws: expected) {
      try await Self.signedIn(transport).guilds()
    }
  }

  @Test
  func `unreadable answers are malformed`() async throws {
    let garbage = StubTransport([.response(status: 200, body: Data("nope".utf8))])
    await #expect(throws: APIError.malformedResponse) {
      try await Self.signedIn(garbage).guilds()
    }
  }

  @Test
  func `signed-out sessions do not send requests`() async throws {
    let transport = StubTransport([])
    let session = AuthSession(oauth: Self.oauth, transport: transport, store: MemorySecretStore())
    let api = try BotgeAPI(baseURL: #require(Self.base), session: session, transport: transport)
    await #expect(throws: APIError.signedOut) {
      try await api.guilds()
    }
    #expect(transport.requests.isEmpty)
  }
}
