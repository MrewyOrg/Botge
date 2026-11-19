@testable import BotgeKit
import Foundation
import Synchronization

/// Never answers; records each request and whether its load was cancelled.
final class HangingTransport: HTTPTransport {
  private static let hang: Duration = .seconds(hangSeconds)
  private static let hangSeconds = 60
  private static let poll: Duration = .milliseconds(pollMilliseconds)
  private static let pollMilliseconds = 10
  private static let polls = 200

  private let state: Mutex = .init((requests: 0, cancelled: 0))

  var requests: Int {
    state.withLock { $0.requests }
  }

  var cancelled: Int {
    state.withLock { $0.cancelled }
  }

  deinit {
    // Counters are released with the stub.
  }

  func data(for _: URLRequest) async throws -> (Data, URLResponse) {
    state.withLock { $0.requests += 1 }
    do {
      try await Task.sleep(for: Self.hang)
    } catch {
      state.withLock { $0.cancelled += 1 }
      throw error
    }
    throw URLError(.timedOut)
  }

  /// Waits up to two seconds for `condition`.
  func wait(until condition: (HangingTransport) -> Bool) async {
    for _ in 0 ..< Self.polls where !condition(self) {
      try? await Task.sleep(for: Self.poll)
    }
  }
}
