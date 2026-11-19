/// A server's emote catalog and what the signed-in member may do with it.
public struct Catalog: Decodable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case canComposeDiscovery
    case canManageEmotes
    case emotes
  }

  /// Every emote, in catalog precedence order.
  public let emotes: [CatalogEmote]
  /// Whether the member may add and remove individual 7TV emotes.
  public let canManageEmotes: Bool
  /// Whether `/emote-compose` accepts 7TV emotes the server has not added.
  public let canComposeDiscovery: Bool

  /// Creates a catalog; tests and previews use this.
  ///
  /// - Parameters:
  ///   - emotes: Every emote in precedence order.
  ///   - canManageEmotes: Whether the member may add and remove emotes.
  ///   - canComposeDiscovery: Whether unadded 7TV emotes can be composed.
  public init(emotes: [CatalogEmote], canManageEmotes: Bool, canComposeDiscovery: Bool) {
    self.emotes = emotes
    self.canManageEmotes = canManageEmotes
    self.canComposeDiscovery = canComposeDiscovery
  }
}
