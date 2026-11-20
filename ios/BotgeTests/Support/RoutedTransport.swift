@testable import Botge
import BotgeKit
import Foundation
import Synchronization

/// Answers chosen routes with scripted replies and everything else from the UI-test fixtures.
final class RoutedTransport: HTTPTransport {
  /// One scripted answer.
  enum Reply: Sendable {
    case failure(URLError.Code)
    case json(status: Int, body: String)
    /// A successful answer with raw bytes, such as an image.
    case bytes(Data)
    /// Answers after a pause, so a test can act while the request is in flight.
    indirect case delayed(Self)
  }

  /// Signs in as the fixture user: Discord's token endpoint issues fixture tokens.
  static let tokenReply: Reply = .json(
    status: okStatus,
    body: #"{"access_token":"fresh","token_type":"Bearer","expires_in":600,"scope":"identify"}"#
  )
  /// HTTP 200.
  private static let okStatus = 200
  /// How long a delayed reply waits.
  private static let delay: Duration = .milliseconds(delayMilliseconds)
  /// ``delay`` in milliseconds.
  private static let delayMilliseconds = 300

  private let state: Mutex<(routes: [String: [Reply]], requests: [URLRequest])>

  /// Requests sent so far.
  var requests: [URLRequest] {
    state.withLock { $0.requests }
  }

  /// Creates a transport that answers every request from the fixtures.
  convenience init() {
    self.init([:])
  }

  /// Creates a transport whose `routes` answer requests whose path ends with the key, in order;
  /// a route's last reply repeats.
  init(_ routes: [String: [Reply]]) {
    state = Mutex((routes, []))
  }

  deinit {
    // Recorded requests are released with the transport.
  }

  func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    let path = request.url?.path() ?? ""
    let reply = state.withLock { state -> Reply? in
      state.requests.append(request)
      guard let key = state.routes.keys.first(where: { path.hasSuffix($0) }),
            var replies = state.routes[key], let first = replies.first
      else {
        return nil
      }

      if replies.count > 1 {
        replies.removeFirst()
        state.routes[key] = replies
      }
      return first
    }
    return try await answer(reply, to: request)
  }

  /// Turns a scripted reply into a response.
  ///
  /// - Throws: The scripted `URLError`, or the fixtures' error for unscripted routes.
  private func answer(_ reply: Reply?, to request: URLRequest) async throws -> (Data, URLResponse) {
    let url = request.url ?? URL(filePath: "/")
    switch reply {
    case let .delayed(next):
      try await Task.sleep(for: Self.delay)
      return try await answer(next, to: request)

    case let .failure(code):
      throw URLError(code)

    case let .json(status, body):
      let response = HTTPURLResponse(
        url: url,
        statusCode: status,
        httpVersion: nil,
        headerFields: nil
      )
      return (Data(body.utf8), response ?? URLResponse())

    case let .bytes(data):
      let response = HTTPURLResponse(
        url: url,
        statusCode: Self.okStatus,
        httpVersion: nil,
        headerFields: nil
      )
      return (data, response ?? URLResponse())

    case nil:
      return try FixtureTransport().data(for: request)
    }
  }
}
