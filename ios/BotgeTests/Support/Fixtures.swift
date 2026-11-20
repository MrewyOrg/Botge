@testable import Botge
import BotgeKit
import Foundation

/// Shared values for app tests.
enum Fixtures {
  /// The fixture server.
  static let guild: SharedGuild = .init(
    id: "100000000000000001",
    name: "Fixture Server",
    icon: nil,
    isAdministrator: true
  )

  /// A server the user does not administer.
  static let memberGuild: SharedGuild = .init(
    id: "100000000000000002",
    name: "Member Server",
    icon: nil,
    isAdministrator: false
  )

  /// A 7TV emote the server added.
  static let added: CatalogEmote = .init(
    name: "peepoHey",
    source: .sevenTV,
    image: "/7tv-cdn/emote/A/2x.webp",
    isAnimated: true,
    isAdded: true,
    composeToken: "peepoHey",
    sevenTVID: "A"
  )

  /// A 7TV emote the server lacks.
  static let discovered: CatalogEmote = .init(
    name: "catJAM",
    source: .sevenTV,
    image: "/7tv-cdn/emote/B/2x.webp",
    isAnimated: true,
    sevenTVID: "B"
  )

  /// How often ``wait(until:)`` checks its condition.
  private static let poll: Duration = .milliseconds(pollMilliseconds)
  /// ``poll`` in milliseconds.
  private static let pollMilliseconds = 10
  /// Checks before ``wait(until:)`` gives up: two seconds in all.
  private static let polls = 200

  /// A model with the fixture backend, before it restores the login.
  ///
  /// - Parameter signedIn: Whether fixture tokens are stored.
  static func model(signedIn: Bool) -> AppModel {
    model(signedIn: signedIn, transport: FixtureTransport(), sockets: FixtureSockets())
  }

  /// A model with scripted services, before it restores the login.
  ///
  /// - Parameters:
  ///   - signedIn: Whether fixture tokens are stored.
  ///   - transport: Answers requests.
  ///   - sockets: Opens WebSocket connections.
  static func model(
    signedIn: Bool,
    transport: any HTTPTransport,
    sockets: any SocketConnecting
  )
    -> AppModel
  {
    UITestSupport.fixtureModel(signedIn: signedIn, transport: transport, sockets: sockets)
  }

  /// A model with the fixture backend, restored to the signed-in phase.
  static func signedIn() async -> AppModel {
    await signedIn(transport: FixtureTransport(), sockets: FixtureSockets())
  }

  /// A signed-in model whose requests `transport` answers.
  ///
  /// - Parameter transport: Answers requests.
  static func signedIn(transport: any HTTPTransport) async -> AppModel {
    await signedIn(transport: transport, sockets: FixtureSockets())
  }

  /// A signed-in model whose connections `sockets` opens.
  ///
  /// - Parameter sockets: Opens WebSocket connections.
  static func signedIn(sockets: any SocketConnecting) async -> AppModel {
    await signedIn(transport: FixtureTransport(), sockets: sockets)
  }

  /// A signed-in model with scripted services.
  ///
  /// - Parameters:
  ///   - transport: Answers requests.
  ///   - sockets: Opens WebSocket connections.
  static func signedIn(
    transport: any HTTPTransport,
    sockets: any SocketConnecting
  )
    async -> AppModel
  {
    let model = Self.model(signedIn: true, transport: transport, sockets: sockets)
    await model.restore()
    return model
  }

  /// A model whose build has no deployment values.
  static func misconfigured() -> AppModel {
    AppModel(
      configuration: .failure(.missingAPIBaseURL),
      transport: FixtureTransport(),
      store: MemorySecretStore(),
      urlCache: URLCache(memoryCapacity: 0, diskCapacity: 0),
      sockets: FixtureSockets(),
      snapshots: SnapshotCache(
        directory: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
      )
    )
  }

  /// Waits until `condition` holds, polling for up to two seconds.
  ///
  /// - Parameter condition: What to wait for.
  static func wait(until condition: () -> Bool) async {
    for _ in 0 ..< polls where !condition() {
      try? await Task.sleep(for: poll)
    }
  }
}
