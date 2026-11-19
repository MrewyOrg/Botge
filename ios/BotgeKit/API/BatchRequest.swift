/// Applies one action to up to ``BotgeAPI/maxBatch`` 7TV emotes.
struct BatchRequest: Encodable {
  private enum CodingKeys: String, CodingKey {
    case action
    case emoteIDs = "emoteIds"
    case guildID = "guildId"
  }

  /// The Discord server ID.
  let guildID: String
  /// The change to apply.
  let action: EmoteAction
  /// The distinct 7TV emote IDs.
  let emoteIDs: [String]
}
