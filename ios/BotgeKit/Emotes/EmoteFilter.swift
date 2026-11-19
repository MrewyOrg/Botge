import Foundation

/// Search and filter settings for a catalog, matching the Activity's rules.
public struct EmoteFilter: Equatable, Sendable {
  /// Most tag terms one filter uses; later terms are ignored.
  public static let maxTagTerms = 12

  /// Text the emote name must contain, ignoring case.
  public var query = ""
  /// The provider to show, or `nil` for all.
  public var source: EmoteSource?
  /// Animated, still, or both.
  public var motion: MotionFilter = .any
  /// Overlay, regular, or both.
  public var overlay: OverlayFilter = .any
  /// Show only emotes the server added individually.
  public var showsOnlyAdded = false
  /// Comma-separated tag terms; every term must match one of an emote's tags.
  public var tags = ""

  /// How many filters besides the search text are active, for the filter button badge.
  public var activeCount: Int {
    [source != nil, motion != .any, overlay != .any, showsOnlyAdded, !tagTerms.isEmpty]
      .count { $0 }
  }

  /// The lowercased tag terms, at most ``maxTagTerms``.
  var tagTerms: [String] {
    let terms = tags.lowercased()
      .split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    return Array(terms.prefix(Self.maxTagTerms))
  }

  /// Creates a filter that shows everything.
  public init() {
    // Every property starts at its show-everything value.
  }

  /// Whether `emote` passes every active filter.
  public func matches(_ emote: CatalogEmote) -> Bool {
    let search = query.trimmingCharacters(in: .whitespaces).lowercased()
    let terms = tagTerms
    let labels = emote.filterTags.map { $0.lowercased() }
    return (search.isEmpty || emote.name.lowercased().contains(search))
      && (source == nil || emote.source == source)
      && (motion == .any || emote.isAnimated == (motion == .animated))
      && (overlay == .any || emote.isOverlay == (overlay == .overlaying))
      && (!showsOnlyAdded || emote.isAdded)
      && terms.allSatisfy { term in labels.contains { $0.contains(term) } }
  }

  /// The emotes that pass, in catalog order.
  ///
  /// - Parameter emotes: A catalog in precedence order.
  /// - Returns: The matching emotes, in the same order.
  public func matchingEmotes(in emotes: [CatalogEmote]) -> [CatalogEmote] {
    emotes.filter(matches)
  }
}
