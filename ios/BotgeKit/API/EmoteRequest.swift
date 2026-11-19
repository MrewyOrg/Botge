/// Adds or removes one 7TV emote.
struct EmoteRequest: Encodable {
  private enum CodingKeys: String, CodingKey {
    case emoteID = "emoteId"
    case guildID = "guildId"
  }

  /// The Discord server ID.
  let guildID: String
  /// The 7TV emote ID.
  let emoteID: String
}
