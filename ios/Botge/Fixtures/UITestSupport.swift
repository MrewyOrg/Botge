#if DEBUG
import BotgeKit
import Foundation

/// Debug-only fixtures that let UI tests run without Discord or the network.
///
/// Enabled by the `BOTGE_UI_TEST` environment variable from the test plans. Release builds do not
/// contain this type.
enum UITestSupport {
  /// A model whose session is signed in with fixture tokens, or `nil` outside UI tests.
  ///
  /// - Returns: A signed-in fixture model, or `nil` outside UI tests.
  static func makeModel() -> AppModel? {
    let environment = ProcessInfo.processInfo.environment
    guard environment["BOTGE_UI_TEST"] == "1" else {
      return nil
    }

    // Each UI test starts without a saved server choice.
    UserDefaults.standard.removeObject(forKey: PreferenceKey.defaultGuildID)
    return fixtureModel(
      signedIn: environment["BOTGE_UI_TEST_SIGNED_OUT"] != "1",
      transport: FixtureTransport(),
      sockets: FixtureSockets()
    )
  }

  /// A model that answers from fixtures and never reaches the network.
  ///
  /// - Parameters:
  ///   - signedIn: Whether fixture tokens are stored, so the model restores a login.
  ///   - transport: Answers requests.
  ///   - sockets: Opens WebSocket connections.
  /// - Returns: A fixture model in the ``AppModel/Phase/restoring`` phase.
  static func fixtureModel(
    signedIn: Bool,
    transport: any HTTPTransport,
    sockets: any SocketConnecting
  )
    -> AppModel
  {
    let store = MemorySecretStore()
    if signedIn {
      let tokens = OAuthTokens(
        accessToken: "fixture",
        refreshToken: "fixture",
        expiresAt: .distantFuture,
        scope: DiscordOAuth.scope
      )
      try? store.write(JSONEncoder().encode(tokens), for: AuthSession.tokenKey)
    }
    return AppModel(
      configuration: Result(catching: fixtureConfiguration),
      transport: transport,
      store: store,
      urlCache: URLCache(memoryCapacity: 0, diskCapacity: 0),
      sockets: sockets,
      snapshots: SnapshotCache(
        directory: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
      )
    )
  }

  /// Loopback configuration that never reaches a real server.
  ///
  /// - Returns: Loopback values that never reach a real server.
  /// - Throws: Never in practice; the fixed values are valid.
  private static func fixtureConfiguration() throws(ConfigurationError) -> AppConfiguration {
    try AppConfiguration(
      apiBaseURL: "http://127.0.0.1:9/app/v1",
      discordApplicationID: "100000000000000001",
      allowsLocalHTTP: true
    )
  }
}
#endif
