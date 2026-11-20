@testable import Botge
import BotgeKit
import Foundation
import Synchronization

/// Opens scripted rooms in order, then rooms that end at once.
final class ScriptedRooms: SocketConnecting {
  private let rooms: Mutex<[ScriptedRoom]>

  init(_ rooms: [ScriptedRoom]) {
    self.rooms = Mutex(rooms)
  }

  deinit {
    // Rooms are released with the connector.
  }

  func connect(to _: URL) -> any MessageSocket {
    rooms.withLock { $0.isEmpty ? ScriptedRoom([]) : $0.removeFirst() }
  }
}
