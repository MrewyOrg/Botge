@testable import BotgeKit
import Foundation
import Synchronization

/// Returns queued responses in order and records every request.
final class StubTransport: HTTPTransport {
  /// One queued answer.
  enum Reply {
    case failure(URLError.Code)
    case response(status: Int, body: Data)
    /// A response without HTTP metadata.
    case plain
  }

  private let state: Mutex<(replies: [Reply], requests: [URLRequest])>

  /// Requests sent so far.
  var requests: [URLRequest] {
    state.withLock { $0.requests }
  }

  init(_ replies: [Reply]) {
    state = Mutex((replies, []))
  }

  deinit {
    // Recorded requests are released with the stub.
  }

  static func json(_ status: Int, _ object: [String: any Sendable]) -> Reply {
    let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    return .response(status: status, body: body)
  }

  func data(for request: URLRequest) throws -> (Data, URLResponse) {
    let reply = state.withLock { state -> Reply? in
      state.requests.append(request)
      return state.replies.isEmpty ? nil : state.replies.removeFirst()
    }
    switch reply {
    case let .failure(code):
      throw URLError(code)

    case let .response(status, body):
      let url = request.url ?? URL(filePath: "/")
      let response = HTTPURLResponse(
        url: url,
        statusCode: status,
        httpVersion: nil,
        headerFields: nil
      )
      return (body, response ?? URLResponse())

    case .plain:
      return (Data(), URLResponse())

    case nil:
      throw URLError(.resourceUnavailable)
    }
  }
}
