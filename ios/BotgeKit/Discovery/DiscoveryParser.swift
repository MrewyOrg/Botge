import Foundation

/// Validates 7TV discovery responses, mirroring the Activity's `parseDiscoveryPage`.
enum DiscoveryParser {
  /// The GraphQL search query the Activity sends.
  static let query = """
  query Discover($query: String, $page: Int!, $perPage: Int!, $sort: Sort!, $filters: Filters, \
  $tags: Tags) { emotes { search(query: $query, page: $page, perPage: $perPage, sort: $sort, \
  filters: $filters, tags: $tags) { pageCount items { id defaultName tags \
  flags { animated nsfw private publicListed defaultZeroWidth } images { url } } } } }
  """
  /// Grid images prefer 2x; previews prefer the largest scale.
  static let tileSizes = ["2x", "1x", "3x", "4x"]
  /// Preview image scales, largest first.
  static let previewSizes = ["4x", "3x", "2x", "1x"]
  /// Image formats 7TV publishes, in the Activity's order.
  static let formats = ["webp", "avif", "png", "gif"]
  /// Longest accepted emote name, in characters.
  static let maxNameLength = 80
  /// Most tags kept per emote.
  static let maxTags = 32

  /// Decodes and validates one page.
  ///
  /// - Parameter data: The response body.
  /// - Returns: The accepted emotes and the page count.
  /// - Throws: ``APIError/malformedResponse`` when GraphQL reports errors or the page is invalid.
  static func page(from data: Data) throws(APIError) -> DiscoveryPage {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          root["errors"] == nil,
          let search = ((root["data"] as? [String: Any])?["emotes"] as? [String: Any])?["search"]
          as? [String: Any],
          let items = search["items"] as? [Any],
          let pageCount = search["pageCount"] as? Int,
          pageCount >= 0
    else {
      throw .malformedResponse
    }

    return DiscoveryPage(emotes: items.compactMap(emote), pageCount: pageCount)
  }

  /// Converts one search item, or returns `nil` when it is unsafe or malformed.
  ///
  /// - Parameter value: One untrusted search item.
  /// - Returns: A catalog entry without server state.
  static func emote(_ value: Any) -> CatalogEmote? {
    guard let item = value as? [String: Any],
          let id = item["id"] as? String, SevenTVID.isValid(id),
          let name = item["defaultName"] as? String, isAcceptable(name),
          let flags = item["flags"] as? [String: Any],
          flags["nsfw"] as? Bool == false,
          flags["private"] as? Bool == false,
          flags["publicListed"] as? Bool == true,
          let isAnimated = flags["animated"] as? Bool,
          let images = item["images"] as? [Any]
    else {
      return nil
    }

    let urls = Set(images.compactMap { ($0 as? [String: Any])?["url"] as? String })
    guard let tile = imagePath(urls, id, tileSizes) else {
      return nil
    }

    let preview = imagePath(urls, id, previewSizes)
    let tags = tags(item["tags"] as? [Any] ?? [])
    return CatalogEmote(
      name: name,
      source: .sevenTV,
      image: tile,
      isAnimated: isAnimated,
      isOverlay: flags["defaultZeroWidth"] as? Bool ?? false,
      tags: tags,
      sevenTVID: id,
      preview: preview == tile ? nil : preview
    )
  }

  /// Whether a provider name is non-empty, short and free of control characters.
  ///
  /// - Parameter name: The provider's default name.
  /// - Returns: Whether to accept it.
  static func isAcceptable(_ name: String) -> Bool {
    !name.trimmingCharacters(in: .whitespaces).isEmpty
      && name.count <= maxNameLength
      && !name.unicodeScalars.contains { $0.properties.generalCategory == .control }
  }

  /// The catalog path of the first published size, as `/7tv-cdn/emote/ID/2x.webp`.
  ///
  /// - Parameters:
  ///   - urls: Image URLs 7TV listed.
  ///   - id: The emote ID.
  ///   - sizes: Scales in preference order.
  /// - Returns: The path, or `nil` when no listed URL is on 7TV's CDN.
  static func imagePath(_ urls: Set<String>, _ id: String, _ sizes: [String]) -> String? {
    for size in sizes {
      for format in formats {
        let path = "/emote/\(id)/\(size).\(format)"
        if urls.contains("https://cdn.7tv.app" + path) {
          return "/7tv-cdn" + path
        }
      }
    }
    return nil
  }

  /// Trimmed, distinct, non-empty tags, at most ``maxTags``.
  ///
  /// - Parameter values: Untrusted tag values.
  /// - Returns: The tags in their original order.
  static func tags(_ values: [Any]) -> [String] {
    var tags = [String]()
    for case let value as String in values {
      let tag = value.trimmingCharacters(in: .whitespaces)
      if !tag.isEmpty, !tags.contains(tag), tags.count < maxTags {
        tags.append(tag)
      }
    }
    return tags
  }
}
