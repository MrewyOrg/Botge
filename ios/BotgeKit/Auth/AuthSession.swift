public import Foundation

/// Owns the signed-in user's Discord tokens: login exchange, renewal, persistence and logout.
///
/// Concurrent callers that need a fresh token share one renewal request. Tokens live only in the
/// ``SecretStore``; nothing is written to preferences or logs.
public actor AuthSession {
  /// The secret store key holding the encoded ``OAuthTokens``.
  public static let tokenKey = "discord.tokens"

  /// Builds token, refresh and revoke requests.
  private let oauth: DiscordOAuth
  /// Sends requests to Discord.
  private let transport: any HTTPTransport
  /// Persists tokens between runs.
  private let store: any SecretStore
  /// Current time; injected so tests control expiry.
  private let clock: @Sendable () -> Date
  /// Tokens for the signed-in user, or `nil` when signed out.
  private var tokens: OAuthTokens?
  /// The renewal in flight, shared by concurrent callers.
  private var renewal: Task<OAuthTokens, any Error>?

  /// Whether tokens are available, from this run or the Keychain.
  public var isSignedIn: Bool {
    tokens != nil
  }

  /// Creates a session and restores tokens saved by an earlier run, if any.
  ///
  /// Unreadable saved tokens are discarded, which signs the user out.
  ///
  /// - Parameters:
  ///   - oauth: Builds Discord token requests.
  ///   - transport: Sends requests to Discord.
  ///   - store: Persists tokens between runs.
  ///   - clock: Returns the current time; tests fix it.
  public init(
    oauth: DiscordOAuth,
    transport: any HTTPTransport,
    store: any SecretStore,
    clock: @escaping @Sendable () -> Date = Date.init
  ) {
    self.oauth = oauth
    self.transport = transport
    self.store = store
    self.clock = clock
    tokens = (try? store.read(Self.tokenKey))
      .flatMap(\.self)
      .flatMap { try? JSONDecoder().decode(OAuthTokens.self, from: $0) }
  }

  /// Exchanges an authorization code from the login sheet and saves the tokens.
  ///
  /// - Parameters:
  ///   - code: The authorization code from Discord's redirect.
  ///   - pkce: The pair whose challenge started the login.
  /// - Throws: ``LoginFailure`` when Discord rejects the code or cannot be reached, and
  ///   ``SecretStoreError`` when the Keychain refuses the tokens.
  public func signIn(code: String, pkce: PKCE) async throws {
    let request = oauth.tokenRequest(code: code, pkce: pkce)
    try await save(exchange(request))
  }

  /// Returns an access token that is valid for at least 30 more seconds, renewing it if needed.
  ///
  /// - Throws: ``AuthSessionError/signedOut`` without tokens, and ``LoginFailure`` when renewal
  ///   fails. A rejected refresh token signs the user out.
  public func accessToken() async throws -> String {
    guard let current = tokens else {
      throw AuthSessionError.signedOut
    }

    if !current.isExpiring(at: clock()) {
      return current.accessToken
    }
    return try await renew().accessToken
  }

  /// Renews the tokens even if they look valid, after the API reported an expired token.
  ///
  /// - Returns: The renewed tokens.
  /// - Throws: ``AuthSessionError/signedOut`` without tokens, and ``LoginFailure`` when renewal
  ///   fails. A rejected refresh token signs the user out.
  @discardableResult
  public func renew() async throws -> OAuthTokens {
    if let renewal {
      return try await renewal.value
    }
    guard let refreshToken = tokens?.refreshToken else {
      try signOutLocally()
      throw AuthSessionError.signedOut
    }

    let request = oauth.refreshRequest(refreshToken: refreshToken)
    let task = Task { try await exchange(request) }
    renewal = task
    defer { renewal = nil }
    do {
      let renewed = try await task.value
      try save(renewed)
      return renewed
    } catch LoginFailure.rejected {
      try signOutLocally()
      throw AuthSessionError.signedOut
    }
  }

  /// Revokes the access token at Discord when possible and deletes the saved tokens.
  ///
  /// Revocation is best effort: logout completes offline, and the token then expires on its own.
  ///
  /// - Throws: ``SecretStoreError`` when the Keychain item cannot be deleted.
  public func signOut() async throws {
    if let accessToken = tokens?.accessToken {
      _ = try? await transport.data(for: oauth.revokeRequest(token: accessToken))
    }
    try signOutLocally()
  }

  /// Sends a token request and decodes the answer.
  ///
  /// - Parameter request: A token, refresh, or revoke request.
  /// - Returns: The tokens Discord issued.
  /// - Throws: ``LoginFailure`` for transport errors and rejected or malformed answers.
  private func exchange(_ request: URLRequest) async throws(LoginFailure) -> OAuthTokens {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await transport.data(for: request)
    } catch {
      throw LoginFailure(authenticationError: error)
    }
    return try DiscordOAuth.tokens(from: data, response: response, now: clock())
  }

  /// Persists tokens, then makes them current.
  ///
  /// - Parameter new: The tokens to store and use.
  /// - Throws: An encoding error or ``SecretStoreError`` when the tokens cannot be stored.
  private func save(_ new: OAuthTokens) throws {
    let data = try JSONEncoder().encode(new)
    try store.write(data, for: Self.tokenKey)
    tokens = new
  }

  /// Forgets the tokens without contacting Discord.
  ///
  /// - Throws: ``SecretStoreError`` when the Keychain item cannot be deleted.
  private func signOutLocally() throws {
    tokens = nil
    try store.delete(Self.tokenKey)
  }
}
