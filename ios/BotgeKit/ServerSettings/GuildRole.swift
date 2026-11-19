/// A server role that can be allowed to manage emotes.
public struct GuildRole: Decodable, Equatable, Identifiable, Sendable {
  /// The Discord role ID.
  public let id: String
  /// The role name.
  public let name: String

  /// Creates a role entry.
  ///
  /// - Parameters:
  ///   - id: The Discord role ID.
  ///   - name: The role name.
  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}
