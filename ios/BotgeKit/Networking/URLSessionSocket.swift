import Foundation

/// Adapts `URLSessionWebSocketTask` to ``MessageSocket``. URLSession answers pings itself.
struct URLSessionSocket: MessageSocket {
  /// The running task.
  let task: URLSessionWebSocketTask

  /// Sends `text` as a text frame.
  ///
  /// - Throws: A `URLError` when the connection fails.
  func send(_ text: String) async throws {
    try await task.send(.string(text))
  }

  /// Waits for the next frame; binary frames are decoded as UTF-8, other frames as empty text.
  ///
  /// - Returns: The message text.
  /// - Throws: A `URLError` when the connection closes or fails.
  func receive() async throws -> String {
    let message = try await task.receive()
    if case let .string(text) = message {
      return text
    }

    var bytes = Data()
    if case let .data(data) = message {
      bytes = data
    }
    return String(bytes: bytes, encoding: .utf8) ?? ""
  }

  /// Closes the connection normally.
  func close() {
    task.cancel(with: .normalClosure, reason: nil)
  }
}
