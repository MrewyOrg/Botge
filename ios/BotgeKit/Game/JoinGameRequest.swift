/// Asks for a ticket to one room of a server.
struct JoinGameRequest: Encodable {
  private enum CodingKeys: String, CodingKey {
    case guildID = "guildId"
    case instanceID = "instanceId"
  }

  /// The Discord server ID.
  let guildID: String
  /// The room, from ``GameRoomCode/instanceID``.
  let instanceID: String
}
