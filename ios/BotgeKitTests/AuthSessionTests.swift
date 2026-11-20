@testable import BotgeKit
import Foundation
import Testing

struct AuthSessionTests {
  private static let oauth: DiscordOAuth = .init(applicationID: "123456789012345678")
  private static let start: Date = .init(timeIntervalSince1970: 10_000)

  private static func tokenReply(_ access: String, expiresIn: Int = 600) -> StubTransport.Reply {
    StubTransport.json(200, [
      "access_token": access,
      "token_type": "Bearer",
      "expires_in": expiresIn,
      "refresh_token": "refresh-\(access)",
      "scope": "identify"
    ])
  }

  private static func session(
    _ transport: StubTransport,
    store: MemorySecretStore = MemorySecretStore()
  )
    -> AuthSession
  {
    AuthSession(oauth: oauth, transport: transport, store: store) { start }
  }

  @Test
  func `sign in saves tokens that survive a restart`() async throws {
    let store = MemorySecretStore()
    let session = Self.session(StubTransport([Self.tokenReply("a")]), store: store)
    #expect(await !session.isSignedIn)
    try await session.signIn(code: "c", pkce: .random())
    #expect(try await session.accessToken() == "a")

    let restored = Self.session(StubTransport([]), store: store)
    #expect(await restored.isSignedIn)
    #expect(try await restored.accessToken() == "a")
  }

  @Test
  func `expiring tokens renew once for concurrent callers`() async throws {
    let transport = StubTransport([Self.tokenReply("a", expiresIn: 20), Self.tokenReply("b")])
    let session = Self.session(transport)
    try await session.signIn(code: "c", pkce: .random())

    async let first = session.accessToken()
    async let second = session.accessToken()
    #expect(try await [first, second] == ["b", "b"])
    #expect(transport.requests.count == 2)
    #expect(RequestBody.form(transport.requests[1])["refresh_token"] == "refresh-a")
  }

  @Test
  func `a rejected refresh token signs the user out`() async throws {
    let store = MemorySecretStore()
    let transport = StubTransport([
      Self.tokenReply("a"),
      StubTransport.json(400, ["error": "invalid_grant"])
    ])
    let session = Self.session(transport, store: store)
    try await session.signIn(code: "c", pkce: .random())
    await #expect(throws: AuthSessionError.signedOut) {
      try await session.renew()
    }
    #expect(await !session.isSignedIn)
    #expect(store.read(AuthSession.tokenKey) == nil)
  }

  @Test
  func `a sign-out during a refresh is not undone when the refresh finishes`() async throws {
    let replies = StubTransport([
      Self.tokenReply("a"),
      Self.tokenReply("b"),
      .response(status: 200, body: Data())
    ])
    let transport = GatedTransport(replies, holding: 2)
    let session = AuthSession(oauth: Self.oauth, transport: transport, store: MemorySecretStore()) {
      Self.start
    }
    try await session.signIn(code: "c", pkce: .random())
    let renewal = Task { try await session.renew() }
    await transport.waitForHeldRequest()
    try await session.signOut()
    transport.open()
    await #expect(throws: AuthSessionError.signedOut) { try await renewal.value }
    #expect(await !session.isSignedIn)
  }

  @Test
  func `callers waiting on a rejected refresh are signed out too`() async throws {
    let replies = StubTransport([
      Self.tokenReply("a"),
      StubTransport.json(400, ["error": "invalid_grant"])
    ])
    let transport = GatedTransport(replies, holding: 2)
    let session = AuthSession(oauth: Self.oauth, transport: transport, store: MemorySecretStore()) {
      Self.start
    }
    try await session.signIn(code: "c", pkce: .random())
    let first = Task { try await session.renew() }
    await transport.waitForHeldRequest()
    let second = Task { try await session.renew() }
    try await Task.sleep(for: .milliseconds(50))
    transport.open()
    await #expect(throws: AuthSessionError.signedOut) { try await first.value }
    await #expect(throws: AuthSessionError.signedOut) { try await second.value }
  }

  @Test
  func `network failures during renewal keep the session`() async throws {
    let transport = StubTransport([Self.tokenReply("a"), .failure(.notConnectedToInternet)])
    let session = Self.session(transport)
    try await session.signIn(code: "c", pkce: .random())
    await #expect(throws: LoginFailure.network) {
      try await session.renew()
    }
    #expect(await session.isSignedIn)
  }

  @Test
  func `signed-out sessions refuse tokens`() async {
    let session = Self.session(StubTransport([]))
    await #expect(throws: AuthSessionError.signedOut) {
      try await session.accessToken()
    }
    await #expect(throws: AuthSessionError.signedOut) {
      try await session.renew()
    }
  }

  @Test
  func `sign out revokes and forgets tokens even offline`() async throws {
    let store = MemorySecretStore()
    let transport = StubTransport([Self.tokenReply("a"), .failure(.notConnectedToInternet)])
    let session = Self.session(transport, store: store)
    try await session.signIn(code: "c", pkce: .random())
    try await session.signOut()
    #expect(await !session.isSignedIn)
    #expect(store.read(AuthSession.tokenKey) == nil)
    #expect(transport.requests.last?.url?.path() == "/api/v10/oauth2/token/revoke")
  }

  @Test
  func `unreadable saved tokens are ignored`() async {
    let store = MemorySecretStore()
    store.write(Data("not json".utf8), for: AuthSession.tokenKey)
    #expect(await !Self.session(StubTransport([]), store: store).isSignedIn)
  }
}
