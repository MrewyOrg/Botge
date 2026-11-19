extension BotgeAPI {
  /// Issues a one-use ticket for a Guess room after Botge checks server membership.
  ///
  /// - Parameters:
  ///   - room: The room to join.
  ///   - guild: The Discord server ID.
  /// - Returns: The ticket and the user's Discord account ID.
  /// - Throws: ``APIError/rejected(_:)`` while too many tickets are waiting, and other
  ///   ``APIError`` cases for rejected or failed requests.
  func gameTicket(room: GameRoomCode, guild: String) async throws(APIError) -> GameTicket {
    try await post("game/join", body: JoinGameRequest(guildID: guild, instanceID: room.instanceID))
  }
}
