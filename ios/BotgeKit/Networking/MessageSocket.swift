/// A WebSocket that exchanges text messages; ``URLSessionSocket`` is the production one.
public protocol MessageSocket: Sendable {
  /// Sends one text message.
  ///
  /// - Parameter text: The message.
  /// - Throws: An error when the connection is closed or fails.
  func send(_ text: String) async throws

  /// Waits for the next text message.
  ///
  /// - Returns: The message text.
  /// - Throws: An error when the connection closes or fails.
  func receive() async throws -> String

  /// Closes the connection; pending ``receive()`` calls fail.
  func close()
}
