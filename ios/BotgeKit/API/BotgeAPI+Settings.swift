import Foundation

extension BotgeAPI {
  /// Loads a server's voice settings and the channels Botge can join. Administrators only.
  ///
  /// - Parameter guild: The Discord server ID.
  /// - Returns: The saved settings and joinable channels.
  /// - Throws: ``APIError/permissionDenied(_:)`` for non-administrators, and other
  ///   ``APIError`` cases for failed or malformed requests.
  public func voiceOptions(guild: String) async throws(APIError) -> VoiceOptions {
    try await post("settings", body: GuildRequest(guildID: guild))
  }

  /// Saves a server's voice settings. Botge applies them to Discord shortly afterwards.
  ///
  /// - Parameters:
  ///   - settings: The new settings; the status text is normalized first.
  ///   - guild: The Discord server ID.
  /// - Returns: The saved settings and joinable channels.
  /// - Throws: ``APIError/rejected(_:)`` for invalid status text or a channel Botge cannot
  ///   join, and other ``APIError`` cases for failed requests.
  public func saveVoice(_ settings: VoiceSettings, guild: String)
    async throws(APIError) -> VoiceOptions
  {
    guard settings.isStatusValid else {
      throw .rejected(String(localized: "The status can't be longer than 128 bytes."))
    }

    return try await post(
      "settings/voice",
      body: VoiceRequest(guildID: guild, voice: settings.normalized)
    )
  }

  /// Loads a server's emote feeds, manager policy and roles. Administrators only.
  ///
  /// - Parameter guild: The Discord server ID.
  /// - Returns: The saved policy and the server's roles.
  /// - Throws: ``APIError/permissionDenied(_:)`` for non-administrators, and other
  ///   ``APIError`` cases for failed or malformed requests.
  public func emotePolicy(guild: String) async throws(APIError) -> EmotePolicyOptions {
    try await post("settings/emotes/read", body: GuildRequest(guildID: guild))
  }

  /// Replaces a server's emote feeds and manager policy.
  ///
  /// - Parameters:
  ///   - policy: The new policy; it is normalized first.
  ///   - guild: The Discord server ID.
  /// - Returns: The saved policy and the server's roles.
  /// - Throws: ``APIError/rejected(_:)`` for an invalid policy, and other ``APIError`` cases
  ///   for failed requests.
  public func saveEmotePolicy(_ policy: EmotePolicy, guild: String)
    async throws(APIError) -> EmotePolicyOptions
  {
    let normalized = policy.normalized
    guard normalized.isValid else {
      throw .rejected(String(localized: "Check the emote sources and roles."))
    }

    return try await post(
      "settings/emotes",
      body: EmotePolicyRequest(guildID: guild, emotes: normalized)
    )
  }

  /// Loads the signed-in user's emote border, which applies in every server.
  ///
  /// - Parameter guild: Any server the user shares with Botge.
  /// - Returns: The border color, or `nil` when the user has none.
  /// - Throws: ``APIError`` for failed, rejected or malformed requests.
  public func borderColor(guild: String) async throws(APIError) -> BorderColor? {
    let response: BorderResponse = try await post(
      "settings/border/read",
      body: GuildRequest(guildID: guild)
    )
    return try Self.parse(response)
  }

  /// Saves or clears the signed-in user's emote border.
  ///
  /// - Parameters:
  ///   - color: The new color, or `nil` for no border.
  ///   - guild: Any server the user shares with Botge.
  /// - Returns: The saved color.
  /// - Throws: ``APIError`` for failed, rejected or malformed requests.
  public func saveBorderColor(_ color: BorderColor?, guild: String)
    async throws(APIError) -> BorderColor?
  {
    let request = BorderRequest(guildID: guild, color: color?.hex ?? "")
    let response: BorderResponse = try await post("settings/border", body: request)
    return try Self.parse(response)
  }

  /// Reads a border answer.
  ///
  /// - Parameter response: The decoded answer.
  /// - Returns: The color, or `nil` for an empty one.
  /// - Throws: ``APIError/malformedResponse`` when the color is not six hexadecimal digits.
  private static func parse(_ response: BorderResponse) throws(APIError) -> BorderColor? {
    guard !response.color.isEmpty else {
      return nil
    }
    guard let color = BorderColor(hex: response.color) else {
      throw .malformedResponse
    }

    return color
  }
}
