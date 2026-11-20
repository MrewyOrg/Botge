@testable import BotgeKit
import Foundation
import Synchronization

/// Accepts sends but never delivers a message until its task is cancelled; records closing.
final class HangingSocket: MessageSocket {
  private static let hang: Duration = .seconds(hangSeconds)
  private static let hangSeconds = 60
  private static let poll: Duration = .milliseconds(pollMilliseconds)
  private static let pollMilliseconds = 10
  private static let polls = 200

  private let state: Mutex = .init((sent: 0, isClosed: false))

  var isClosed: Bool {
    state.withLock { $0.isClosed }
  }

  deinit {
    // Counters are released with the socket.
  }

  func send(_: String) {
    state.withLock { $0.sent += 1 }
  }

  func receive() async throws -> String {
    try await Task.sleep(for: Self.hang)
    throw URLError(.timedOut)
  }

  func close() {
    state.withLock { $0.isClosed = true }
  }

  /// Waits up to two seconds for the first send.
  func waitForSend() async {
    for _ in 0 ..< Self.polls where state.withLock({ $0.sent == 0 }) {
      try? await Task.sleep(for: Self.poll)
    }
  }
}
