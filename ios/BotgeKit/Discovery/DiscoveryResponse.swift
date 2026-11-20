/// A 7TV GraphQL search response, reduced to the accepted emotes and the page count.
///
/// Items that fail ``DiscoveryItem`` validation are dropped one by one; the response itself fails
/// when GraphQL reports errors or the search result is missing or has a negative page count.
struct DiscoveryResponse: Decodable {
  /// Top-level GraphQL fields.
  private enum CodingKeys: String, CodingKey {
    case data
    case emotes
    case errors
    case items
    case pageCount
    case search
  }

  /// The accepted emotes and the page count.
  let page: DiscoveryPage

  /// Decodes `data.emotes.search`.
  ///
  /// - Parameter decoder: The response decoder.
  /// - Throws: `DecodingError` when GraphQL reports errors or the search result is invalid.
  init(from decoder: any Decoder) throws {
    let root = try decoder.container(keyedBy: CodingKeys.self)
    guard !root.contains(.errors) else {
      throw DecodingError.dataCorruptedError(
        forKey: .errors, in: root, debugDescription: "GraphQL reported errors."
      )
    }

    let search = try root
      .nestedContainer(keyedBy: CodingKeys.self, forKey: .data)
      .nestedContainer(keyedBy: CodingKeys.self, forKey: .emotes)
      .nestedContainer(keyedBy: CodingKeys.self, forKey: .search)
    let pageCount = try search.decode(Int.self, forKey: .pageCount)
    guard pageCount >= 0 else {
      throw DecodingError.dataCorruptedError(
        forKey: .pageCount, in: search, debugDescription: "Negative page count."
      )
    }

    let items = try search.decode([LossyDecodable<DiscoveryItem>].self, forKey: .items)
    page = DiscoveryPage(emotes: items.compactMap(\.value?.emote), pageCount: pageCount)
  }
}
