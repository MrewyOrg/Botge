public import Foundation

/// A server the signed-in user shares with Botge, from `POST /guilds`.
public struct SharedGuild: Decodable, Equatable, Identifiable, Sendable {
  /// The Discord server ID.
  public let id: String
  /// The server's display name.
  public let name: String
  /// The server icon on Discord's CDN, if the server has one.
  public let icon: URL?
  /// Whether the user administers the server and may change its settings.
  public let administrator: Bool

  /// Creates a server entry.
  public init(id: String, name: String, icon: URL?, administrator: Bool) {
    self.id = id
    self.name = name
    self.icon = icon
    self.administrator = administrator
  }
}
