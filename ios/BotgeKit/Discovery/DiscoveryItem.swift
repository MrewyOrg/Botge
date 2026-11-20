/// One 7TV search result that passed every safety check, as a catalog entry.
///
/// Decoding fails when the ID or name is unsafe, the emote is NSFW, private or unlisted, a
/// required field is missing or mistyped, or no image is on 7TV's CDN. Tags and the overlay flag
/// are optional, and malformed tags or image entries are skipped.
struct DiscoveryItem: Decodable {
  /// Fields of one search item.
  private enum CodingKeys: String, CodingKey {
    case flags
    case id
    case images
    case name = "defaultName"
    case tags
  }

  /// Fields of an item's `flags` object.
  private enum FlagKeys: String, CodingKey {
    case isAnimated = "animated"
    case isNSFW = "nsfw"
    case isOverlay = "defaultZeroWidth"
    case isPrivate = "private"
    case isPublicListed = "publicListed"
  }

  /// One `images` entry.
  private struct ImageEntry: Decodable {
    /// The image URL 7TV lists.
    let url: String
  }

  /// The accepted emote, without server state.
  let emote: CatalogEmote

  /// Decodes and validates one search item.
  ///
  /// - Parameter decoder: The item's decoder.
  /// - Throws: `DecodingError` when the item is malformed or unsafe.
  init(from decoder: any Decoder) throws {
    let item = try decoder.container(keyedBy: CodingKeys.self)
    let id = try item.decode(String.self, forKey: .id)
    guard SevenTVID.isValid(id) else {
      throw DecodingError.dataCorruptedError(
        forKey: .id, in: item, debugDescription: "Invalid 7TV ID."
      )
    }

    let name = try item.decode(String.self, forKey: .name)
    guard DiscoveryParser.isAcceptable(name) else {
      throw DecodingError.dataCorruptedError(
        forKey: .name, in: item, debugDescription: "Unsafe emote name."
      )
    }

    let flags = try item.nestedContainer(keyedBy: FlagKeys.self, forKey: .flags)
    guard try !flags.decode(Bool.self, forKey: .isNSFW),
          try !flags.decode(Bool.self, forKey: .isPrivate),
          try flags.decode(Bool.self, forKey: .isPublicListed)
    else {
      throw DecodingError.dataCorruptedError(
        forKey: .flags, in: item, debugDescription: "Not a public, listed, safe emote."
      )
    }

    let isAnimated = try flags.decode(Bool.self, forKey: .isAnimated)
    let isOverlay = (try? flags.decodeIfPresent(Bool.self, forKey: .isOverlay)) ?? false
    let urls = try Set(item.decode([LossyDecodable<ImageEntry>].self, forKey: .images)
      .compactMap(\.value?.url))
    guard let tile = DiscoveryParser.imagePath(urls, id, DiscoveryParser.tileSizes) else {
      throw DecodingError.dataCorruptedError(
        forKey: .images, in: item, debugDescription: "No image on 7TV's CDN."
      )
    }

    let preview = DiscoveryParser.imagePath(urls, id, DiscoveryParser.previewSizes)
    let tags = (try? item.decodeIfPresent([LossyDecodable<String>].self, forKey: .tags)) ?? []
    emote = CatalogEmote(
      name: name,
      source: .sevenTV,
      image: tile,
      isAnimated: isAnimated,
      isOverlay: isOverlay,
      tags: DiscoveryParser.tags(tags.compactMap(\.value)),
      sevenTVID: id,
      preview: preview == tile ? nil : preview
    )
  }
}
