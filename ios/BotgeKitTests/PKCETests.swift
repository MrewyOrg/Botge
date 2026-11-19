@testable import BotgeKit
import Foundation
import Testing

struct PKCETests {
  /// The expected value comes from `printf %s VERIFIER | openssl dgst -sha256 -binary | base64`
  /// with `+` replaced by `-` and the `=` padding removed.
  @Test
  func `challenge is the unpadded base64url SHA-256 of the verifier`() {
    let pkce = PKCE(verifier: "dBjftJeZ4CVP-mJ92IIb7S0n8b1nfQOVjB5NI1VEu2sw")
    #expect(pkce.challenge == "N4VsJmoXplyT4HcgikuZtaw3-PN4eUnn3br8rfXX7kw")
  }

  @Test
  func `random verifiers are unique unpadded base64url of 32 bytes`() {
    let first = PKCE.random()
    let second = PKCE.random()
    #expect(first.verifier != second.verifier)
    #expect(first.verifier.count == 43)
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    #expect(first.verifier.unicodeScalars.allSatisfy(allowed.contains))
    #expect(first == PKCE(verifier: first.verifier))
  }
}
