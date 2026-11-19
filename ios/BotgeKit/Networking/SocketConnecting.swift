public import Foundation

/// Opens WebSockets; `URLSession` conforms, and tests substitute scripted sockets.
public protocol SocketConnecting: Sendable {
  /// Starts a WebSocket connection.
  ///
  /// - Parameter url: The `ws` or `wss` URL.
  /// - Returns: The connection, already started.
  func connect(to url: URL) -> any MessageSocket
}

extension URLSession: SocketConnecting {
  /// Starts a `URLSessionWebSocketTask` for `url`.
  ///
  /// - Returns: The started connection.
  public func connect(to url: URL) -> any MessageSocket {
    let task = webSocketTask(with: url)
    task.resume()
    return URLSessionSocket(task: task)
  }
}
