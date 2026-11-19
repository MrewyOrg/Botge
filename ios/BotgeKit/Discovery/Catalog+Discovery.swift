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
    let known = discovered.sevenTVID.flatMap { id in emotes.first { $0.sevenTVID == id } }
    return resolving(discovered, known: known)
  }

  /// Applies the server's state to many discovered emotes, indexing the catalog once.
  ///
  /// - Parameter discovered: Entries from ``SevenTVDiscovery``.
  /// - Returns: The entries in the same order, each as ``resolving(_:)`` returns it.
  public func resolving(_ discovered: [CatalogEmote]) -> [CatalogEmote] {
    var index = [String: CatalogEmote]()
    for emote in emotes {
      if let id = emote.sevenTVID, index[id] == nil {
        index[id] = emote
      }
    }
    return discovered.map { resolving($0, known: $0.sevenTVID.flatMap { index[$0] }) }
  }

  /// Combines a discovered emote with the catalog entry for the same 7TV ID.
  ///
  /// - Parameters:
  ///   - discovered: An entry from ``SevenTVDiscovery``.
  ///   - known: The first catalog entry with the same 7TV ID, if any.
  /// - Returns: The entry with the server's added state and compose token.
  private func resolving(_ discovered: CatalogEmote, known: CatalogEmote?) -> CatalogEmote {
    guard let id = discovered.sevenTVID else {
      return discovered
    }

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
