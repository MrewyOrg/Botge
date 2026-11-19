/// Replaces one server's voice settings.
struct VoiceRequest: Encodable {
  private enum CodingKeys: String, CodingKey {
    case guildID = "guildId"
    case voice
  }

  /// The Discord server ID.
  let guildID: String
  /// The new settings.
  let voice: VoiceSettings
}
