import Foundation

/// Saved voice settings with the channels Botge can join right now.
public struct VoiceOptions: Decodable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case channels
    case settings = "voice"
  }

  /// The saved preference.
  public let settings: VoiceSettings
  /// Channels Botge can join, in Discord's order.
  public let channels: [VoiceChannel]

  /// The channel picker entries: ``channels``, then a saved channel Botge can no longer join,
  /// so it stays visible until the user clears it.
  public var choices: [VoiceChannel] {
    guard let saved = settings.channelID, !channels.contains(where: { $0.id == saved }) else {
      return channels
    }

    return channels + [VoiceChannel(id: saved, name: String(localized: "Unavailable Channel"))]
  }

  /// Creates voice options.
  ///
  /// - Parameters:
  ///   - settings: The saved preference.
  ///   - channels: Channels Botge can join.
  public init(settings: VoiceSettings, channels: [VoiceChannel]) {
    self.settings = settings
    self.channels = channels
  }
}
