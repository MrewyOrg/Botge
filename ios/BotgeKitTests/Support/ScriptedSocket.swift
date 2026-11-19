@testable import BotgeKit
import Foundation
import Synchronization

/// Replays queued messages, then fails as a closed connection; records what was sent.
final class ScriptedSocket: MessageSocket {
  /// The socket's mutable record.
  private struct Record {
    var incoming: [String]
    var sent: [String] = []
    var isClosed = false
  }

  private let record: Mutex<Record>

  var sent: [String] {
    record.withLock { $0.sent }
  }

  var isClosed: Bool {
    record.withLock { $0.isClosed }
  }

  init(_ incoming: [String]) {
    record = Mutex(Record(incoming: incoming))
  }

  deinit {
    // Recorded messages are released with the socket.
  }

  func send(_ text: String) {
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
