/// A voice channel Botge can join, offered by the voice settings.
public struct VoiceChannel: Decodable, Equatable, Identifiable, Sendable {
  /// The Discord channel ID.
  public let id: String
  /// The channel name.
  public let name: String

  /// Creates a channel entry.
  ///
  /// - Parameters:
  ///   - id: The Discord channel ID.
  ///   - name: The channel name.
  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}
