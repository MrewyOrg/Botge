public import Foundation

/// Discord OAuth2 tokens held in the Keychain.
public struct OAuthTokens: Codable, Equatable, Sendable {
  /// Bearer token sent to Discord and the Botge API.
  public let accessToken: String
  /// Token used to renew the access token without another login, when Discord issued one.
  public let refreshToken: String?
  /// When the access token stops working.
  public let expiresAt: Date
  /// Granted scopes, space-separated.
  public let scope: String

  /// Creates a token set.
  public init(accessToken: String, refreshToken: String?, expiresAt: Date, scope: String) {
    self.accessToken = accessToken
    self.refreshToken = refreshToken
    self.expiresAt = expiresAt
    self.scope = scope
  }

  /// Whether the access token expires within `margin` of `now`.
  ///
  /// The Activity renews 30 seconds early; the app uses the same default.
  public func isExpiring(at now: Date, margin: TimeInterval = 30) -> Bool {
    expiresAt.timeIntervalSince(now) <= margin
  }
}
