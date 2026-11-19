public import Foundation

/// Builds and interprets Discord OAuth2 requests for a public client using PKCE.
///
/// The app is a public client: it holds no client secret, so every code exchange carries the
/// PKCE verifier. Only the `identify` scope is requested; server membership comes from Botge.
public struct DiscordOAuth: Equatable, Sendable {
  /// The only scope Botge requests.
  public static let scope = "identify"

  private static let authorizeURL: URL? = URL(string: "https://discord.com/oauth2/authorize")
  private static let tokenURL: URL? = URL(string: "https://discord.com/api/v10/oauth2/token")
  private static let revokeURL: URL? =
    URL(string: "https://discord.com/api/v10/oauth2/token/revoke")

  /// The Discord application (client) ID.
  public let applicationID: String

  /// The URL scheme Discord redirects to, registered in the app's Info.plist.
  public var callbackScheme: String {
    "discord-\(applicationID)"
  }

  /// The redirect URI registered on the Discord application.
  public var redirectURI: String {
    "\(callbackScheme):/authorize/callback"
  }

  /// Creates a client for a Discord application.
  public init(applicationID: String) {
    self.applicationID = applicationID
  }

  /// The authorization page URL opened in the system login sheet.
  public func authorizationURL(pkce: PKCE, state: String) -> URL {
    var components = URLComponents()
    components.queryItems = [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: applicationID),
      URLQueryItem(name: "scope", value: Self.scope),
      URLQueryItem(name: "redirect_uri", value: redirectURI),
      URLQueryItem(name: "code_challenge", value: pkce.challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "state", value: state)
    ]
    let base = Self.authorizeURL ?? URL(filePath: "/")
    return base.appending(queryItems: components.queryItems ?? [])
  }

  /// Extracts the authorization code from Discord's redirect.
  ///
  /// - Throws: ``LoginFailure/stateMismatch`` when `state` differs from `expectedState`,
  ///   ``LoginFailure/denied(_:)`` for an OAuth error, and ``LoginFailure/malformedResponse``
  ///   when the callback is not this application's redirect or has no code.
  public func authorizationCode(from callback: URL, expectedState: String) throws(LoginFailure)
    -> String
  {
    guard callback.scheme == callbackScheme,
          let components = URLComponents(url: callback, resolvingAgainstBaseURL: false)
    else {
      throw .malformedResponse
    }

    let items = components.queryItems ?? []
    func value(_ name: String) -> String? {
      items.first { $0.name == name }?.value
    }
    guard value("state") == expectedState else {
      throw .stateMismatch
    }

    if let error = value("error") {
      throw .denied(error)
    }
    guard let code = value("code"), !code.isEmpty else {
      throw .malformedResponse
    }

    return code
  }

  /// The request that exchanges an authorization code and PKCE verifier for tokens.
  public func tokenRequest(code: String, pkce: PKCE) -> URLRequest {
    formRequest(Self.tokenURL, [
      ("client_id", applicationID),
      ("grant_type", "authorization_code"),
      ("code", code),
      ("redirect_uri", redirectURI),
      ("code_verifier", pkce.verifier)
    ])
  }

  /// The request that renews tokens with a refresh token.
  public func refreshRequest(refreshToken: String) -> URLRequest {
    formRequest(Self.tokenURL, [
      ("client_id", applicationID),
      ("grant_type", "refresh_token"),
      ("refresh_token", refreshToken)
    ])
  }

  /// The request that revokes a token at logout.
  public func revokeRequest(token: String) -> URLRequest {
    formRequest(Self.revokeURL, [
      ("client_id", applicationID),
      ("token", token),
      ("token_type_hint", "access_token")
    ])
  }

  /// Decodes a token endpoint response.
  ///
  /// - Throws: ``LoginFailure/rejected`` for a 4xx answer, ``LoginFailure/network`` for other
  ///   non-success statuses, and ``LoginFailure/malformedResponse`` when the body is invalid.
  public static func tokens(from data: Data, response: URLResponse, now: Date)
    throws(LoginFailure) -> OAuthTokens
  {
    guard let http = response as? HTTPURLResponse else {
      throw .malformedResponse
    }

    switch http.statusCode {
    case HTTPStatus.success:
      break

    case HTTPStatus.clientError:
      throw .rejected

    default:
      throw .network
    }
    guard let body = try? JSONDecoder().decode(TokenResponse.self, from: data),
          body.tokenType.caseInsensitiveCompare("Bearer") == .orderedSame,
          !body.accessToken.isEmpty,
          body.expiresIn > 0
    else {
      throw .malformedResponse
    }

    return OAuthTokens(
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresAt: now.addingTimeInterval(TimeInterval(body.expiresIn)),
      scope: body.scope
    )
  }

  private func formRequest(_ url: URL?, _ fields: [(String, String)]) -> URLRequest {
    var request = URLRequest(url: url ?? URL(filePath: "/"))
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = Data(FormEncoding.encode(fields).utf8)
    return request
  }
}
