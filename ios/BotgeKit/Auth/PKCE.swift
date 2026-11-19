import CryptoKit
import Foundation

/// A Proof Key for Code Exchange pair (RFC 7636) using the `S256` method.
///
/// The verifier stays on the device until the token request; Discord receives only the challenge
/// with the authorization request.
public struct PKCE: Equatable, Sendable {
  /// Random bytes in a verifier or state token.
  static let byteCount = 32

  /// The secret verifier: 43 unreserved characters (32 random bytes, base64url).
  public let verifier: String
  /// `BASE64URL(SHA256(verifier))`, sent with the authorization request.
  public let challenge: String

  /// Derives the challenge for a known verifier.
  public init(verifier: String) {
    self.verifier = verifier
    challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
  }

  /// Creates a pair from 32 bytes of the system's cryptographically secure generator.
  public static func random() -> Self {
    Self(verifier: randomToken())
  }

  /// Returns 32 random bytes as unpadded base64url, also used for the OAuth `state`.
  public static func randomToken() -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0 ..< Self.byteCount)
      .map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    return Data(bytes).base64URLEncodedString()
  }
}

extension Data {
  /// Unpadded base64url encoding (RFC 4648 section 5).
  func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacing("+", with: "-")
      .replacing("/", with: "_")
      .replacing("=", with: "")
  }
}
