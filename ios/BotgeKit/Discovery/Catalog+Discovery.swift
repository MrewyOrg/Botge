extension Catalog {
  /// Applies the server's state to a discovered emote.
  ///
  /// An emote the server already has keeps its compose token and shows as added when the server
  /// added it individually. Others compose as `7tv:ID` when the server allows composing
  /// discovered emotes.
  ///
  /// - Parameter discovered: An entry from ``SevenTVDiscovery``.
  /// - Returns: The entry with the server's added state and compose token.
  public func resolving(_ discovered: CatalogEmote) -> CatalogEmote {
    guard let id = discovered.sevenTVID else {
      return discovered
    }

    let known = emotes.first { $0.sevenTVID == id }
    let token = known?.composeToken ?? (canComposeDiscovery ? "7tv:\(id)" : nil)
    return CatalogEmote(
      name: discovered.name,
      source: discovered.source,
      image: discovered.image,
      isAnimated: discovered.isAnimated,
      isOverlay: discovered.isOverlay,
      tags: discovered.tags,
      isAdded: known?.isAdded ?? false,
      composeToken: token,
      sevenTVID: id,
      preview: discovered.preview
    )
  }
}
