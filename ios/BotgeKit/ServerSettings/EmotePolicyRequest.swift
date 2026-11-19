/// Replaces one server's emote policy.
struct EmotePolicyRequest: Encodable {
  private enum CodingKeys: String, CodingKey {
    case emotes
    case guildID = "guildId"
  }

  /// The Discord server ID.
  let guildID: String
  /// The new policy.
  let emotes: EmotePolicy
}
