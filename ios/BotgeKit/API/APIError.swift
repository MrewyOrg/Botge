/// A Botge API request failed, grouped by what the app shows or does next.
public enum APIError: Error, Equatable, Sendable {
  /// Botge is busy or Discord asked it to slow down; retrying shortly can succeed.
  case busy(String)
  /// The server answered with a body the app does not understand.
  case malformedResponse
  /// The request could not reach Botge.
  case network
  /// The server or route does not exist, for example when the app API is disabled.
  case notFound(String)
  /// The user lacks the permission the operation needs.
  case permissionDenied(String)
  /// Botge rejected the request; the message explains why.
  case rejected(String)
  /// Discord no longer accepts the login; the user must log in again.
  case signedOut
  /// Botge or Discord failed; retrying later can succeed.
  case unavailable(String)

  /// HTTP 403.
  static let forbiddenStatus = 403
  /// HTTP 404.
  static let notFoundStatus = 404
  /// HTTP 429.
  static let tooManyRequestsStatus = 429
  /// HTTP 503.
  static let serviceUnavailableStatus = 503

  /// Classifies a non-success answer by status code and the server's message.
  static func classify(status: Int, message: String) -> Self {
    switch status {
    case forbiddenStatus:
      .permissionDenied(message)

    case notFoundStatus:
      .notFound(message)

    case tooManyRequestsStatus, serviceUnavailableStatus:
      .busy(message)

    case HTTPStatus.clientError:
      .rejected(message)

    default:
      .unavailable(message)
    }
  }
}
