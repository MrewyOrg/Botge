/// Saves or clears the signed-in user's border color.
struct BorderRequest: Encodable {
  private enum CodingKeys: String, CodingKey {
    case color
    case guildID = "guildId"
  }

  /// A server the user shares with Botge; the border applies in every server.
  let guildID: String
  /// Six hexadecimal digits, or empty to clear the border.
  let color: String
}
