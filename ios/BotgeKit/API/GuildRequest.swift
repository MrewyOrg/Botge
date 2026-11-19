/// A request scoped to one server.
struct GuildRequest: Encodable {
  private enum CodingKeys: String, CodingKey {
    case guildID = "guildId"
  }

  /// The Discord server ID.
  let guildID: String
}
