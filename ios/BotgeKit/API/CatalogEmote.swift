/// One emote in a server catalog, as `POST /catalog` serves it.
public struct CatalogEmote: Codable, Equatable, Hashable, Identifiable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case composeToken
    case image
    case isAdded = "added"
    case isAnimated = "animated"
    case isOverlay = "overlaying"
    case name
    case preview
    case sevenTVID = "sevenTVId"
    case source
    case tags
  }

  /// The name people type; unique per catalog only when ``composeToken`` is present.
  public let name: String
  /// The provider that owns the emote.
  public let source: EmoteSource
  /// The catalog image path, such as `/7tv-cdn/emote/ID/2x.webp`.
  public let image: String
  /// A larger image path for the preview, when the provider publishes one.
  public let preview: String?
  /// Whether the provider advertises an animation.
  public let isAnimated: Bool
  /// Whether the emote draws over the preceding emote in a composition.
  public let isOverlay: Bool
  /// Provider search tags.
  public let tags: [String]
  /// Whether the server added this emote individually, so it can be removed.
  public let isAdded: Bool
  /// The token that names this emote in `/emote-compose`, absent when it cannot be composed.
  public let composeToken: String?
  /// The 7TV emote ID, present for 7TV emotes.
  public let sevenTVID: String?

  /// A stable identity within one catalog: the source and image path.
  public var id: String {
    "\(source.rawValue)|\(image)"
  }

  /// The labels that tag filters match: source, motion, overlay, added and provider tags.
  public var filterTags: [String] {
    var labels = [
      source.rawValue,
      isAnimated ? "Animated" : "Static",
      isOverlay ? "Overlaying" : "Regular"
    ]
    if isAdded {
      labels.append("Added")
    }
    for tag in tags where !labels.contains(tag) {
      labels.append(tag)
    }
    return labels
  }

  /// Creates an emote; tests and previews use this.
  ///
  /// - Parameters:
  ///   - name: The emote name.
  ///   - source: The owning provider.
  ///   - image: The catalog image path.
  ///   - isAnimated: Whether the emote animates.
  ///   - isOverlay: Whether the emote draws over the previous one.
  ///   - tags: Provider search tags.
  ///   - isAdded: Whether the server added it individually.
  ///   - composeToken: The compose token, if it can be composed.
  ///   - sevenTVID: The 7TV emote ID, for 7TV emotes.
  ///   - preview: A larger image path, if published.
  public init(
    name: String,
    source: EmoteSource,
    image: String,
    isAnimated: Bool,
    isOverlay: Bool = false,
    tags: [String] = [],
    isAdded: Bool = false,
    composeToken: String? = nil,
    sevenTVID: String? = nil,
    preview: String? = nil
  ) {
    self.name = name
    self.source = source
    self.image = image
    self.preview = preview
    self.isAnimated = isAnimated
    self.isOverlay = isOverlay
    self.tags = tags
    self.isAdded = isAdded
    self.composeToken = composeToken
    self.sevenTVID = sevenTVID
  }

  /// Decodes a catalog entry; absent flags and tags default to `false` and empty.
  ///
  /// - Parameter decoder: The decoder holding one catalog entry.
  /// - Throws: `DecodingError` when a required field is missing or has the wrong type.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    name = try container.decode(String.self, forKey: .name)
    source = try container.decode(EmoteSource.self, forKey: .source)
    image = try container.decode(String.self, forKey: .image)
    preview = try container.decodeIfPresent(String.self, forKey: .preview)
    isAnimated = try container.decode(Bool.self, forKey: .isAnimated)
    isOverlay = try container.decodeIfPresent(Bool.self, forKey: .isOverlay) ?? false
    tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
    isAdded = try container.decodeIfPresent(Bool.self, forKey: .isAdded) ?? false
    composeToken = try container.decodeIfPresent(String.self, forKey: .composeToken)
    sevenTVID = try container.decodeIfPresent(String.self, forKey: .sevenTVID)
  }
}
