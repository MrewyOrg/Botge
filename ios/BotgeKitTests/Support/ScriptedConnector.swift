@testable import BotgeKit
import Foundation
import Synchronization

/// Hands out scripted sockets in order and records the URLs connected to.
final class ScriptedConnector: SocketConnecting {
  private let state: Mutex<(sockets: [ScriptedSocket], urls: [URL])>

  var urls: [URL] {
    state.withLock { $0.urls }
  }

  init(_ sockets: [ScriptedSocket]) {
    state = Mutex((sockets, []))
  }

  deinit {
    // Sockets are released with the connector.
  }

  func connect(to url: URL) -> any MessageSocket {
    state.withLock { state in
      state.urls.append(url)
      return state.sockets.isEmpty ? ScriptedSocket([]) : state.sockets.removeFirst()
    }
  }
}
