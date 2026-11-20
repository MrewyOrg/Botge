@testable import BotgeKit
import Foundation

/// Builds API clients that are signed in with fixed tokens.
enum TestAPI {
  /// The API base URL the clients use.
  static let baseURL: URL = .init(literal: "https://botge.example.com/botge-api/app/v1")
  /// The Discord client the sessions renew tokens with.
  static let oauth: DiscordOAuth = .init(applicationID: "123456789012345678")

  /// A client whose session holds a long-lived access token and no refresh token.
  ///
  /// - Parameter transport: Answers the client's requests.
  /// - Returns: The client.
  /// - Throws: An encoding or Keychain error when the tokens cannot be stored.
  static func signedIn(_ transport: StubTransport) throws -> BotgeAPI {
    try signedIn(transport, accessToken: "t", refreshToken: nil)
  }

  /// A client whose session holds the given tokens.
  ///
  /// - Parameters:
  ///   - transport: Answers the client's requests.
  ///   - accessToken: The stored access token.
  ///   - refreshToken: The stored refresh token, if any.
  /// - Returns: The client.
  /// - Throws: An encoding or Keychain error when the tokens cannot be stored.
  static func signedIn(
    _ transport: StubTransport,
    accessToken: String,
    refreshToken: String?
  )
    throws -> BotgeAPI
  {
    let store = MemorySecretStore()
    let tokens = OAuthTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: .distantFuture,
      scope: DiscordOAuth.scope
    )
    try store.write(JSONEncoder().encode(tokens), for: AuthSession.tokenKey)
    let session = AuthSession(oauth: oauth, transport: transport, store: store)
    return BotgeAPI(baseURL: baseURL, session: session, transport: transport)
  }
}
