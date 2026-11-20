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

  /// Waits for the next frame.
  ///
  /// - Returns: The message text, as ``text(of:)`` reads it.
  /// - Throws: A `URLError` when the connection closes or fails.
  func receive() async throws -> String {
    try await Self.text(of: task.receive())
  }

  /// The text of a frame: binary frames are read as UTF-8, and invalid UTF-8 or unknown frame
  /// kinds read as empty text.
  ///
  /// - Parameter message: A received frame.
  /// - Returns: The frame's text.
  static func text(of message: URLSessionWebSocketTask.Message) -> String {
    switch message {
    case let .data(data):
      String(bytes: data, encoding: .utf8) ?? ""

    case let .string(text):
      text

    @unknown default:
      ""
    }
  }

  /// Closes the connection normally.
  func close() {
    task.cancel(with: .normalClosure, reason: nil)
  }
}
