public import Foundation

/// Joins Guess rooms and resolves their round images.
public struct GameClient: Sendable {
  /// Issues tickets and knows the deployment's URLs.
  private let api: BotgeAPI
  /// Opens connections.
  private let connector: any SocketConnecting

  /// Creates a client.
  ///
  /// - Parameters:
  ///   - api: The Botge API client.
  ///   - connector: Opens WebSocket connections.
  public init(api: BotgeAPI, connector: any SocketConnecting) {
    self.api = api
    self.connector = connector
  }

  /// Joins `room` in `guild` and returns the open connection.
  ///
  /// The server sends the room's state as soon as it accepts the ticket.
  ///
  /// - Parameters:
  ///   - room: The room to join.
  ///   - guild: The Discord server ID.
  /// - Returns: The connection.
  /// - Throws: ``APIError`` when no ticket could be issued, and ``APIError/network`` when
  ///   the connection cannot be opened.
  public func join(_ room: GameRoomCode, guild: String) async throws(APIError) -> GameConnection {
    let ticket = try await api.gameTicket(room: room, guild: guild)
    guard let url = await api.socketURL("game/ws"),
          let data = try? JSONEncoder().encode(["type": "join", "ticket": ticket.ticket]),
          let join = String(bytes: data, encoding: .utf8)
    else {
      throw .malformedResponse
    }

    let socket = connector.connect(to: url)
    do {
      try await socket.send(join)
    } catch {
      socket.close()
      throw .network
    }
    return GameConnection(userID: ticket.userID, socket: socket)
  }

  /// The URL of a round image.
  ///
  /// - Parameter token: The state's ``GameState/image`` token.
  /// - Returns: The image URL, or `nil` for a token with unexpected characters.
  public func imageURL(for token: String) -> URL? {
    guard !token.isEmpty,
          token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else {
      return nil
    }

    return api.baseURL.appending(path: "game/image/\(token)")
  }
}
