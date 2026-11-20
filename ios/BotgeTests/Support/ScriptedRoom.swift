@testable import Botge
import BotgeKit
import Foundation
import Synchronization

/// A Guess room connection that delivers queued messages, then ends.
final class ScriptedRoom: MessageSocket {
  private let state: Mutex<[String]>

  init(_ incoming: [String]) {
    state = Mutex(incoming)
  }

  deinit {
    // Recorded messages are released with the room.
  }

  func send(_: String) {
    // The room's script does not depend on what the player sends.
  }

  func receive() throws -> String {
    let next = state.withLock { incoming -> String? in
      incoming.isEmpty ? nil : incoming.removeFirst()
    }
    guard let next else {
      throw URLError(.networkConnectionLost)
    }

    return next
  }

  func close() {
    // Nothing to release.
  }
}
