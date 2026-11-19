public import Foundation

/// A server the signed-in user shares with Botge, from `POST /guilds`.
public struct SharedGuild: Decodable, Equatable, Identifiable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case icon
    case id
    case isAdministrator = "administrator"
    case name
  }

  /// The Discord server ID.
  public let id: String
  /// The server's display name.
  public let name: String
  /// The server icon on Discord's CDN, if the server has one.
  public let icon: URL?
  /// Whether the user administers the server and may change its settings.
  public let isAdministrator: Bool

  /// Creates a server entry.
  ///
  /// - Parameters:
  ///   - id: The Discord server ID.
  ///   - name: The server name.
  ///   - icon: The icon URL, if any.
  ///   - isAdministrator: Whether the user administers the server.
  public init(id: String, name: String, icon: URL?, isAdministrator: Bool) {
    self.id = id
    self.name = name
    self.icon = icon
    self.isAdministrator = isAdministrator
  }
}
