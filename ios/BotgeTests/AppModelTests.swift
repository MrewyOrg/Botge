@testable import Botge
import BotgeKit
import Foundation
import Testing

struct AppModelTests {
  /// Answers Discord's login sheet with a code for the state it was given.
  ///
  /// - Throws: An issue when the login URL has no state.
  private static func approve(_ url: URL, _ scheme: String) throws -> URL {
    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let state = try #require(items.first { $0.name == "state" }?.value)
    return try #require(URL(string: "\(scheme):/authorize/callback?code=c&state=\(state)"))
  }

  @Test
  func `a saved login restores to the signed-in phase and a missing one to login`() async {
    let signedIn = await Fixtures.signedIn()
    #expect(signedIn.phase == .signedIn)
    let signedOut = Fixtures.model(signedIn: false)
    await signedOut.restore()
    #expect(signedOut.phase == .signedOut)
    await signedOut.restore()
    #expect(signedOut.phase == .signedOut)
  }

  @Test
  func `a misconfigured build offers nothing to sign in to`() async {
    let model = Fixtures.misconfigured()
    #expect(model.phase == .misconfigured(.missingAPIBaseURL))
    await model.restore()
    await model.signIn { _, _ in
      Issue.record("A misconfigured build must not open the login sheet.")
      throw URLError(.cancelled)
    }
    await model.loadGuilds()
    #expect(model.phase == .misconfigured(.missingAPIBaseURL))
    #expect(model.makeCatalogWatch() == nil)
    #expect(model.makeGameClient() == nil)
  }

  @Test
  func `signing in exchanges the code for tokens`() async {
    let transport = RoutedTransport(["oauth2/token": [RoutedTransport.tokenReply]])
    let model = Fixtures.model(signedIn: false, transport: transport, sockets: FixtureSockets())
    await model.restore()
    await model.signIn { url, scheme in try Self.approve(url, scheme) }
    #expect(model.phase == .signedIn)
    #expect(model.loginFailure == nil)
    #expect(!model.isSigningIn)
  }

  @Test
  func `cancelled logins show nothing and failed ones explain why`() async {
    let model = Fixtures.model(signedIn: false)
    await model.restore()
    await model.signIn { _, _ in throw URLError(.cancelled) }
    #expect(model.loginFailure == nil)
    await model.signIn { url, scheme in try Self.approve(url, scheme) }
    #expect(model.loginFailure == .network)
    #expect(model.phase == .signedOut)
  }

  @Test
  func `servers load, failures are kept, and a rejected login signs out`() async {
    let transport = RoutedTransport([
      "guilds": [
        .failure(.notConnectedToInternet),
        .json(status: 200, body: #"{"guilds":[]}"#),
        .json(status: 401, body: #"{"message":"no"}"#)
      ]
    ])
    let model = await Fixtures.signedIn(transport: transport)
    await model.loadGuilds()
    #expect(model.guildsFailure == .network)
    #expect(!model.hasLoadedGuilds)
    await model.loadGuilds()
    #expect(model.guildsFailure == nil)
    #expect(model.hasLoadedGuilds)
    await model.loadGuilds()
    #expect(model.phase == .signedOut)
    #expect(!model.hasLoadedGuilds)
  }

  @Test
  func `searches open the Emotes tab and caches can be cleared`() async {
    let model = await Fixtures.signedIn()
    model.selectedTab = .settings
    model.search("  catJAM\n")
    #expect(model.selectedTab == .emotes)
    #expect(model.pendingSearch == "catJAM")
    #expect(model.makeCatalogWatch() != nil)
    #expect(model.makeGameClient() != nil)
    await model.clearImageCache()
    #expect(model.urlCache.currentMemoryUsage == 0)
  }

  @Test
  func `the Keychain service is the bundle ID and intents get the model`() async throws {
    let empty = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: true)
    let bundle = try #require(Bundle(url: empty))
    #expect(AppModel.keychainService(in: bundle) == "Botge")
    #expect(AppModel.keychainService(in: .main) == Bundle.main.bundleIdentifier)
    let model = Fixtures.misconfigured()
    #expect(await model.intentDependency() === model)
  }
}
