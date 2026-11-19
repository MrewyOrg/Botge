/// One page of 7TV discovery results.
public struct DiscoveryPage: Codable, Equatable, Sendable {
  /// Public, listed, non-NSFW emotes, as catalog entries without server state.
  public let emotes: [CatalogEmote]
  /// The number of pages 7TV reports for this query.
  public let pageCount: Int

  /// Creates a page.
  ///
  /// - Parameters:
  ///   - emotes: The accepted emotes.
  ///   - pageCount: The provider's page count.
  public init(emotes: [CatalogEmote], pageCount: Int) {
    self.emotes = emotes
    self.pageCount = pageCount
  }
}
