import Foundation
import Network
import Synchronization

/// A WebSocket server on 127.0.0.1 that answers each text message with a text and a binary echo.
final class LoopbackWebSocketServer: Sendable {
  private let listener: NWListener
  private let queue: DispatchQueue = .init(label: "LoopbackWebSocketServer")

  /// The `ws://` URL clients connect to, available after ``start()``.
  var url: URL? {
    listener.port.flatMap { URL(string: "ws://127.0.0.1:\($0.rawValue)/catalog/ws") }
  }

  init() throws {
    let parameters = NWParameters.tcp
    parameters.defaultProtocolStack.applicationProtocols.insert(
      NWProtocolWebSocket.Options(),
      at: 0
    )
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }

  deinit {
    listener.cancel()
  }

  /// Starts listening and waits until the port is assigned.
  func start() async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let resumed = Mutex(false)
      listener.stateUpdateHandler = { state in
        guard case .ready = state else {
          return
        }

        let first = resumed.withLock { done in
          defer { done = true }
          return !done
        }
        if first {
          continuation.resume()
        }
      }
      listener.newConnectionHandler = { [queue] connection in
        connection.start(queue: queue)
        Self.echo(connection)
      }
      listener.start(queue: queue)
    }
  }

  private static func echo(_ connection: NWConnection) {
    connection.receiveMessage { data, _, _, error in
      guard error == nil, let data else {
        return
      }

      for opcode in [NWProtocolWebSocket.Opcode.text, .binary] {
        let metadata = NWProtocolWebSocket.Metadata(opcode: opcode)
        let context = NWConnection.ContentContext(identifier: "echo", metadata: [metadata])
        connection.send(content: data, contentContext: context, completion: .idempotent)
      }
      echo(connection)
    }
  }
}
