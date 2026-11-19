import Foundation

/// An open connection to a Guess room.
///
/// Receive in one task and send from another; closing ends both.
public struct GameConnection: Sendable {
  /// The signed-in user's Discord account ID, as it appears in the scoreboard.
  public let userID: String
  /// The room connection.
  private let socket: any MessageSocket

  /// Wraps an accepted connection.
  ///
  /// - Parameters:
  ///   - userID: The signed-in user's Discord account ID.
  ///   - socket: The room connection, after the join message was sent.
  init(userID: String, socket: any MessageSocket) {
    self.userID = userID
    self.socket = socket
  }

  /// Sends a command to the room.
  ///
  /// - Parameter command: The command; guesses longer than the server checks are not sent.
  /// - Throws: ``APIError/network`` when the connection is closed.
  public func send(_ command: GameCommand) async throws(APIError) {
    if case let .guess(text) = command, text.utf8.count > GameCommand.maxGuessBytes {
      return
    }

    guard let data = try? JSONEncoder().encode(command.body),
          let text = String(bytes: data, encoding: .utf8)
    else {
      throw .malformedResponse
    }

    do {
      try await socket.send(text)
    } catch {
      throw .network
    }
  }

  /// Waits for the next message the app understands, skipping unknown ones.
  ///
  /// - Returns: The message.
  /// - Throws: ``APIError/network`` when the connection ends.
  public func receive() async throws(APIError) -> GameMessage {
    while true {
      let text: String
      do {
        text = try await socket.receive()
      } catch {
        throw .network
      }
      if let message = try? JSONDecoder().decode(GameMessage.self, from: Data(text.utf8)) {
        return message
      }
    }
  }

  /// Closes the connection, which frees the player's place in the room.
  public func close() {
    socket.close()
  }
}
