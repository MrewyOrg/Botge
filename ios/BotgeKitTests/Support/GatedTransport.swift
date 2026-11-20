@testable import BotgeKit
import Foundation
import Synchronization

/// Answers from a ``StubTransport`` but holds one response until ``open()``.
final class GatedTransport: HTTPTransport {
  /// Polls while waiting for the held request.
  private static let poll: Duration = .milliseconds(pollMilliseconds)
  /// ``poll`` in milliseconds.
  private static let pollMilliseconds = 10
  /// Most polls before giving up.
  private static let polls = 200

  /// Supplies the replies, in order.
  private let stub: StubTransport
  /// The one-based request number to hold.
  private let held: Int
  /// Releases the held response.
  private let gate: (stream: AsyncStream<Void>, continuation: AsyncStream<Void>.Continuation) =
    AsyncStream.makeStream()
  /// Requests received so far.
  private let count: Mutex = .init(0)

  /// Creates a transport that holds request `held`.
  ///
  /// - Parameters:
  ///   - stub: Supplies the replies, in order.
  ///   - held: The one-based request number to hold.
  init(_ stub: StubTransport, holding held: Int) {
    self.stub = stub
    self.held = held
  }

  deinit {
    gate.continuation.finish()
  }

  /// Answers in order, waiting for ``open()`` before returning the held response.
  ///
  /// - Parameter request: The request.
  /// - Returns: The stub's reply.
  /// - Throws: The stub's failure.
  func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    let number = count.withLock { count in
      count += 1
      return count
    }
    let reply = try stub.data(for: request)
    if number == held {
      for await _ in gate.stream {
        break
      }
    }
    return reply
  }

  /// Releases the held response.
  func open() {
    gate.continuation.yield()
  }

  /// Waits until the held request has arrived.
  func waitForHeldRequest() async {
    for _ in 0 ..< Self.polls where count.withLock({ $0 }) < held {
      try? await Task.sleep(for: Self.poll)
    }
  }
}
