@testable import BotgeKit
import Foundation
import Synchronization
import Testing

struct CatalogWatchTests {
  private static func api(_ transport: StubTransport) throws -> BotgeAPI {
    let store = MemorySecretStore()
    let tokens = OAuthTokens(
      accessToken: "t",
      refreshToken: nil,
      expiresAt: .distantFuture,
      scope: "identify"
    )
    try store.write(JSONEncoder().encode(tokens), for: AuthSession.tokenKey)
    let session = AuthSession(
      oauth: DiscordOAuth(applicationID: "123456789012345678"),
      transport: transport,
      store: store
    )
    return try BotgeAPI(
      baseURL: #require(URL(string: "https://botge.example.com/app/v1")),
      session: session,
      transport: transport
    )
  }

  /// A pause that records each delay and stops the watch after `limit` pauses.
  private static func pauses(limit: Int) -> (CatalogWatch.Pause, @Sendable () -> [Duration]) {
    let recorded = Mutex<[Duration]>([])
    let pause: CatalogWatch.Pause = { duration in
      let count = recorded.withLock { delays in
        delays.append(duration)
        return delays.count
      }
      if count >= limit {
        throw CancellationError()
      }
    }
    return (pause, { recorded.withLock { $0 } })
  }

  @Test
  func `changes are reported and reconnects back off then reset`() async throws {
    let ticket = StubTransport.json(200, ["ticket": "abc"])
    let transport = StubTransport([ticket, .failure(.notConnectedToInternet), ticket])
    let first = ScriptedSocket([
      #"{"type":"watching"}"#,
      #"{"type":"changed"}"#,
      #"{"type":"changed"}"#
    ])
    let refused = ScriptedSocket([#"{"type":"error","message":"no"}"#])
    let connector = ScriptedConnector([first, refused])
    let (pause, delays) = Self.pauses(limit: 3)
    let changes = Mutex(0)
    let watch = try CatalogWatch(api: Self.api(transport), connector: connector, pause: pause)
    try await watch.run(guild: "1") {
      changes.withLock { $0 += 1 }
    }
    #expect(changes.withLock { $0 } == 2)
    #expect(first.sent == [#"{"type":"watch","ticket":"abc"}"#])
    #expect(first.isClosed && refused.isClosed)
    #expect(connector.urls.first?.absoluteString == "wss://botge.example.com/app/v1/catalog/ws")
    #expect(delays() == [.seconds(1), .seconds(2), .seconds(4)])
  }

  @Test
  func `delays stop growing at the maximum`() async throws {
    let transport = StubTransport(Array(repeating: .failure(.timedOut), count: 8))
    let (pause, delays) = Self.pauses(limit: 7)
    let watch = try CatalogWatch(
      api: Self.api(transport),
      connector: ScriptedConnector([]),
      pause: pause
    )
    try await watch.run(guild: "1") {
      // No connection succeeds.
    }
    #expect(delays().last == CatalogWatch.maximumDelay)
  }

  @Test
  func `a rejected login ends the watch`() async throws {
    let transport = StubTransport([StubTransport.json(401, ["message": "no"])])
    let (pause, _) = Self.pauses(limit: 1)
    let watch = try CatalogWatch(
      api: Self.api(transport),
      connector: ScriptedConnector([]),
      pause: pause
    )
    await #expect(throws: APIError.signedOut) {
      try await watch.run(guild: "1") {
        // Never called.
      }
    }
  }

  @Test
  func `the default pause sleeps and honours cancellation`() async {
    let task = Task {
      try await CatalogWatch.sleep(.seconds(60))
    }
    task.cancel()
    await #expect(throws: CancellationError.self) {
      try await task.value
    }
  }
}
