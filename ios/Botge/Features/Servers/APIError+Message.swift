import BotgeKit
import Foundation

extension APIError {
  /// What went wrong, using the server's explanation when it sent one.
  var message: String {
    switch self {
    case let .busy(text):
      Self.explained(text)

    case .malformedResponse:
      String(localized: "Botge sent an answer this version of the app does not understand.")

    case .network:
      String(localized: "Botge could not be reached. Check your connection and try again.")

    case let .notFound(text):
      Self.explained(text)

    case let .permissionDenied(text):
      Self.explained(text)

    case let .rejected(text):
      Self.explained(text)

    case .signedOut:
      String(localized: "Your Discord login expired. Log in again.")

    case let .unavailable(text):
      Self.explained(text)
    }
  }

  /// The server's explanation, or a generic one when it sent none.
  private static func explained(_ text: String) -> String {
    if text.isEmpty {
      String(localized: "Botge could not complete the request.")
    } else {
      text
    }
  }
}
