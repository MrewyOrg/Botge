/// The session cannot provide a token without a new login.
public enum AuthSessionError: Error, Equatable, Sendable {
  /// No tokens are stored, or Discord rejected the refresh token.
  case signedOut
}
