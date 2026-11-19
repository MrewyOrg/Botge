import Foundation

/// Why Discord login or token renewal failed, grouped by what the user can do about it.
public enum LoginFailure: Error, Equatable, Sendable {
  /// The user closed the login sheet.
  case cancelled
  /// Discord returned an OAuth error such as `access_denied`.
  case denied(String)
  /// The callback or token response was missing required values.
  case malformedResponse
  /// The network request failed before Discord answered.
  case network
  /// The login page could not load or finish, for example while offline or while Lockdown Mode
  /// restricts the page. Retrying usually helps.
  case pageFailed
  /// The system could not present the login sheet.
  case presentationUnavailable
  /// Discord rejected the code or refresh token; the user must log in again.
  case rejected
  /// The callback's `state` did not match the request, so the response was discarded.
  case stateMismatch

  /// The NSError domain used by `ASWebAuthenticationSession`.
  public static let webAuthenticationDomain =
    "com.apple.AuthenticationServices.WebAuthenticationSession"

  /// `ASWebAuthenticationSessionError.Code.canceledLogin`.
  static let canceledLoginCode = 1
  /// `presentationContextNotProvided` and `presentationContextInvalid`.
  static let presentationCodes: Set = [missingContextCode, invalidContextCode]
  private static let missingContextCode = 2
  private static let invalidContextCode = 3

  /// Whether retrying the same action can succeed without other changes.
  public var isRetryable: Bool {
    switch self {
    case .network, .pageFailed, .presentationUnavailable:
      true

    case .cancelled, .denied, .malformedResponse, .rejected, .stateMismatch:
      false
    }
  }

  /// Classifies an error thrown by the system login sheet or `URLSession`.
  ///
  /// `ASWebAuthenticationSession` reports code 1 for cancellation and codes 2 and 3 for
  /// presentation problems. Any other failure while the page was open is treated as a page
  /// failure, which includes content that Lockdown Mode blocks.
  public init(authenticationError error: any Error) {
    if let known = error as? Self {
      self = known
      return
    }

    let nsError = error as NSError
    switch nsError.domain {
    case Self.webAuthenticationDomain where nsError.code == Self.canceledLoginCode:
      self = .cancelled

    case Self.webAuthenticationDomain where Self.presentationCodes.contains(nsError.code):
      self = .presentationUnavailable

    case NSURLErrorDomain:
      self = nsError.code == NSURLErrorCancelled ? .cancelled : .network

    default:
      self = .pageFailed
    }
  }
}
