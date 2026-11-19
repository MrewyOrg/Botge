import BotgeKit
import Foundation
import Observation

/// App-wide state: deployment configuration, the Discord session and shared services.
@Observable
final class AppModel {
  /// Where the user is in the sign-in flow.
  enum Phase: Equatable {
    /// The build has no valid deployment values; login is impossible.
    case misconfigured(ConfigurationError)
    /// Waiting for Discord login.
    case signedOut
    /// Tokens are available.
    case signedIn
  }

  /// The current step of the sign-in flow.
  private(set) var phase: Phase
  /// The last login failure to show, cleared when a new attempt starts.
  private(set) var loginFailure: LoginFailure?
  /// Whether a login is in progress; the login button is disabled meanwhile.
  private(set) var isSigningIn = false
  /// Servers the user shares with Botge; empty until ``hasLoadedGuilds``.
  private(set) var guilds: [SharedGuild] = []
  /// Whether ``guilds`` holds a loaded list.
  private(set) var hasLoadedGuilds = false
  /// Why the server list could not load, if it failed.
  private(set) var guildsFailure: APIError?

  /// OAuth request builder, or `nil` when the build is misconfigured.
  let oauth: DiscordOAuth?
  /// The Discord token session, or `nil` when the build is misconfigured.
  let session: AuthSession?
  /// The Botge app API client, or `nil` when the build is misconfigured.
  let api: BotgeAPI?
  /// Shared emote image loader.
  let imageLoader: EmoteImageLoader
  /// Disk and memory cache behind every image download.
  let urlCache: URLCache
  /// Opens catalog and game WebSocket connections.
  let sockets: any SocketConnecting

  /// Creates a model from validated configuration and injected services.
  ///
  /// - Parameters:
  ///   - configuration: Validated deployment values, or why they are invalid.
  ///   - transport: Sends Discord and Botge requests.
  ///   - store: Keeps the Discord tokens.
  ///   - urlCache: Caches downloaded images.
  ///   - sockets: Opens WebSocket connections.
  init(
    configuration: Result<AppConfiguration, ConfigurationError>,
    transport: any HTTPTransport,
    store: any SecretStore,
    urlCache: URLCache,
    sockets: any SocketConnecting
  ) {
    self.urlCache = urlCache
    self.sockets = sockets
    imageLoader = EmoteImageLoader(transport: transport)
    switch configuration {
    case let .success(values):
      let client = DiscordOAuth(applicationID: values.discordApplicationID)
      let tokens = AuthSession(oauth: client, transport: transport, store: store)
      oauth = client
      session = tokens
      api = BotgeAPI(baseURL: values.apiBaseURL, session: tokens, transport: transport)
      phase = .signedOut

    case let .failure(error):
      oauth = nil
      session = nil
      api = nil
      phase = .misconfigured(error)
    }
  }

  deinit {
    // The model lives for the whole app run; its services need no explicit teardown.
  }

  /// Builds the production model from the bundle's Info.plist and shared caches.
  ///
  /// - Returns: A model for this app run, or the UI-test fixture model in debug UI tests.
  static func makeLive() -> AppModel {
    #if DEBUG
    if let model = UITestSupport.makeModel() {
      return model
    }
    #endif
    let cache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 256 << 20)
    let sessionConfiguration = URLSessionConfiguration.default
    sessionConfiguration.urlCache = cache
    sessionConfiguration.requestCachePolicy = .useProtocolCachePolicy
    sessionConfiguration.waitsForConnectivity = false
    let result = Result { () throws(ConfigurationError) in
      try AppConfiguration(infoDictionary: Bundle.main.infoDictionary ?? [:])
    }
    let urlSession = URLSession(configuration: sessionConfiguration)
    return AppModel(
      configuration: result,
      transport: urlSession,
      store: KeychainStore(service: Bundle.main.bundleIdentifier ?? "Botge"),
      urlCache: cache,
      sockets: urlSession
    )
  }

  /// Restores a saved session at launch.
  func restore() async {
    guard let session, await session.isSignedIn else {
      return
    }

    phase = .signedIn
  }

  /// Runs the Discord login sheet and exchanges the code.
  ///
  /// - Parameter authenticate: Opens `url` in the system login sheet and returns Discord's
  ///   redirect; supplied by the view's `webAuthenticationSession`.
  func signIn(authenticate: (URL, String) async throws -> URL) async {
    guard let oauth, let session, !isSigningIn else {
      return
    }

    isSigningIn = true
    loginFailure = nil
    defer { isSigningIn = false }
    let pkce = PKCE.random()
    let state = PKCE.makeToken()
    do {
      let callback = try await authenticate(
        oauth.authorizationURL(pkce: pkce, state: state),
        oauth.callbackScheme
      )
      let code = try oauth.authorizationCode(from: callback, expectedState: state)
      try await session.signIn(code: code, pkce: pkce)
      phase = .signedIn
    } catch {
      let failure = LoginFailure(authenticationError: error)
      loginFailure = failure == .cancelled ? nil : failure
    }
  }

  /// Revokes and forgets the Discord tokens, then returns to the login screen.
  func signOut() async {
    try? await session?.signOut()
    await imageLoader.clearMemory()
    guilds = []
    hasLoadedGuilds = false
    guildsFailure = nil
    phase = .signedOut
  }

  /// Loads the servers the user shares with Botge.
  ///
  /// A rejected login returns to the login screen; other failures are kept in
  /// ``guildsFailure`` for the picker to show with a retry.
  func loadGuilds() async {
    guard let api else {
      return
    }

    guildsFailure = nil
    do {
      guilds = try await api.guilds()
      hasLoadedGuilds = true
    } catch .signedOut {
      await signOut()
    } catch {
      guildsFailure = error
    }
  }

  /// Creates the catalog watch for this deployment, or `nil` when the build is misconfigured.
  ///
  /// - Returns: A watch that reconnects with backoff.
  func makeCatalogWatch() -> CatalogWatch? {
    api.map { CatalogWatch(api: $0, connector: sockets) }
  }

  /// Clears the downloaded and decoded image caches.
  func clearImageCache() async {
    urlCache.removeAllCachedResponses()
    await imageLoader.clearMemory()
  }
}
