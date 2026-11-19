import BotgeKit
import Foundation

extension LoginFailure {
  /// What went wrong and what to do next, shown under the login button.
  var message: LocalizedStringResource {
    switch self {
    case .cancelled:
      "Login was cancelled."

    case .presentationUnavailable:
      "The login sheet could not open. Try again."

    case .pageFailed:
      """
      Discord's login page did not finish loading. Check your connection and try again; \
      with Lockdown Mode on, the page can take longer to load.
      """

    case .malformedResponse, .stateMismatch:
      "Discord's answer could not be verified. Try logging in again."

    case let .denied(reason):
      "Discord did not allow the login (\(reason))."

    case .rejected:
      "Discord rejected the login. Log in again."

    case .network:
      "Discord could not be reached. Check your connection and try again."
    }
  }
}
