public import Foundation

/// Builds and interprets Discord OAuth2 requests for a public client using PKCE.
///
/// The app is a public client: it holds no client secret, so every code exchange carries the
/// PKCE verifier. Only the `identify` scope is requested; server membership comes from Botge.
public struct DiscordOAuth: Equatable, Sendable {
  /// The only scope Botge requests.
  public static let scope = "identify"

  /// The authorization page opened in the login sheet.
  static let authorizeURL: URL = .init(literal: "https://discord.com/oauth2/authorize")
  /// The code exchange and refresh endpoint.
  static let tokenURL: URL = .init(literal: "https://discord.com/api/v10/oauth2/token")
  /// The token revocation endpoint.
  static let revokeURL: URL = .init(literal: "https://discord.com/api/v10/oauth2/token/revoke")
  /// RFC 3986 unreserved characters, the only ones a form body leaves unescaped.
  private static let unreserved: CharacterSet = .init(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  )

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
  ///
  /// - Parameter applicationID: The Discord application ID.
  public init(applicationID: String) {
    self.applicationID = applicationID
  }

  /// The authorization page URL opened in the system login sheet.
  ///
  /// - Parameters:
  ///   - pkce: The pair whose challenge the URL carries.
  ///   - state: A random value the callback must echo.
  /// - Returns: The URL to open in the login sheet.
  public func authorizationURL(pkce: PKCE, state: String) -> URL {
    Self.authorizeURL.appending(queryItems: [
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "client_id", value: applicationID),
      URLQueryItem(name: "scope", value: Self.scope),
      URLQueryItem(name: "redirect_uri", value: redirectURI),
      URLQueryItem(name: "code_challenge", value: pkce.challenge),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "state", value: state)
    ])
  }

  /// Extracts the authorization code from Discord's redirect.
  ///
  /// - Parameters:
  ///   - callback: The URL Discord redirected to.
  ///   - expectedState: The state sent with the request.
  /// - Returns: The authorization code.
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
  ///
  /// - Parameters:
  ///   - code: The authorization code.
  ///   - pkce: The pair whose challenge started the login.
  /// - Returns: A form-encoded `POST` to the token endpoint.
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
  ///
  /// - Parameter refreshToken: The refresh token Discord issued.
  /// - Returns: A form-encoded `POST` to the token endpoint.
  public func refreshRequest(refreshToken: String) -> URLRequest {
    formRequest(Self.tokenURL, [
      ("client_id", applicationID),
      ("grant_type", "refresh_token"),
      ("refresh_token", refreshToken)
    ])
  }

  /// The request that revokes a token at logout.
  ///
  /// - Parameter token: The access token to revoke.
  /// - Returns: A form-encoded `POST` to the revoke endpoint.
  public func revokeRequest(token: String) -> URLRequest {
    formRequest(Self.revokeURL, [
      ("client_id", applicationID),
      ("token", token),
      ("token_type_hint", "access_token")
    ])
  }

  /// Decodes a token endpoint response.
  ///
  /// - Parameters:
  ///   - data: The response body.
  ///   - response: The HTTP response.
  ///   - now: The time the response arrived, for the expiry date.
  /// - Returns: The issued tokens.
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

  private func formRequest(_ url: URL, _ fields: [(String, String)]) -> URLRequest {
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.httpBody = Data(Self.formBody(fields).utf8)
    return request
  }

  /// Encodes ordered fields as an `application/x-www-form-urlencoded` body.
  ///
  /// - Parameter fields: Names and values, in order.
  /// - Returns: `name=value` pairs joined by `&`, with everything but unreserved characters
  ///   percent-encoded.
  static func formBody(_ fields: [(String, String)]) -> String {
    fields
      .map { name, value in "\(escape(name))=\(escape(value))" }
      .joined(separator: "&")
  }

  /// Percent-encodes everything except unreserved characters.
  ///
  /// - Parameter text: A field name or value.
  /// - Returns: The encoded text; text Foundation cannot encode is sent unchanged.
  private static func escape(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text
  }
}
