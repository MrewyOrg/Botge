@testable import BotgeKit
import Foundation
import Synchronization
import Testing

struct CatalogWatchTests {
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
    let watch = try CatalogWatch(
      api: TestAPI.signedIn(transport),
      connector: connector,
      pause: pause
    )
    try await watch.run(guild: "1") {
      changes.withLock { $0 += 1 }
    }
    #expect(changes.withLock { $0 } == 2)
    #expect(first.sent == [#"{"type":"watch","ticket":"abc"}"#])
    #expect(first.isClosed && refused.isClosed)
    #expect(connector.urls.first?
      .absoluteString == "wss://botge.example.com/botge-api/app/v1/catalog/ws")
    #expect(delays() == [.seconds(1), .seconds(2), .seconds(4)])
  }

  @Test
  func `a reconnect reports a change to catch up on missed ones`() async throws {
    let ticket = StubTransport.json(200, ["ticket": "abc"])
    let transport = StubTransport([ticket, ticket])
    let first = ScriptedSocket([#"{"type":"watching"}"#])
    let second = ScriptedSocket([#"{"type":"watching"}"#])
    let (pause, _) = Self.pauses(limit: 2)
    let changes = Mutex(0)
    let watch = try CatalogWatch(
      api: TestAPI.signedIn(transport),
      connector: ScriptedConnector([first, second]),
      pause: pause
    )
    try await watch.run(guild: "1") {
      changes.withLock { $0 += 1 }
    }
    // The first session needs no catch-up; the reconnect reloads once.
    #expect(changes.withLock { $0 } == 1)
  }

  @Test
  func `delays stop growing at the maximum`() async throws {
    let transport = StubTransport(Array(repeating: .failure(.timedOut), count: 8))
    let (pause, delays) = Self.pauses(limit: 7)
    let watch = try CatalogWatch(
      api: TestAPI.signedIn(transport),
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
      api: TestAPI.signedIn(transport),
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

  @Test
  func `cancelling a watch closes its connection`() async throws {
    let transport = StubTransport([StubTransport.json(200, ["ticket": "abc"])])
    let socket = HangingSocket()
    let watch = try CatalogWatch(
      api: TestAPI.signedIn(transport),
      connector: ScriptedConnector([socket])
    )
    let task = Task {
      try await watch.run(guild: "1") {
        // No change arrives.
      }
    }
    await socket.waitForSend()
    task.cancel()
    _ = try? await task.value
    #expect(socket.isClosed)
  }

  @Test
  func `the default pause returns after a short wait`() async throws {
    try await CatalogWatch.sleep(.milliseconds(1))
  }

  @Test
  func `a watch cancelled during its pause stops`() async throws {
    let transport = StubTransport([.failure(.timedOut)])
    let pause: CatalogWatch.Pause = { _ in
      withUnsafeCurrentTask { $0?.cancel() }
    }
    let watch = try CatalogWatch(
      api: TestAPI.signedIn(transport),
      connector: ScriptedConnector([]),
      pause: pause
    )
    try await watch.run(guild: "1") {
      // No connection succeeds.
    }
    #expect(transport.requests.count == 1)
  }
}
