@testable import BotgeKit
import Foundation
import Synchronization

/// Replays queued messages, then fails as a closed connection; records what was sent.
///
/// A socket created with `failsToSend` rejects every send, like a connection the server refused.
final class ScriptedSocket: MessageSocket {
  /// The socket's mutable record.
  private struct Record {
    var incoming: [String]
    var sent: [String] = []
    var isClosed = false
  }

  private let record: Mutex<Record>
  private let failsToSend: Bool

  var sent: [String] {
    record.withLock { $0.sent }
  }

  var isClosed: Bool {
    record.withLock { $0.isClosed }
  }

  convenience init(_ incoming: [String]) {
    self.init(incoming, failsToSend: false)
  }

  init(_ incoming: [String], failsToSend: Bool) {
    record = Mutex(Record(incoming: incoming))
    self.failsToSend = failsToSend
  }

  deinit {
    // Recorded messages are released with the socket.
  }

  func send(_ text: String) throws {
    if failsToSend {
      throw URLError(.cannotConnectToHost)
    }
    record.withLock { $0.sent.append(text) }
  }

  func receive() throws -> String {
    let next = record.withLock { record -> String? in
      record.incoming.isEmpty ? nil : record.incoming.removeFirst()
    }
    guard let next else {
      throw URLError(.networkConnectionLost)
    }

    return next
  }

  func close() {
    record.withLock { $0.isClosed = true }
  }
}
