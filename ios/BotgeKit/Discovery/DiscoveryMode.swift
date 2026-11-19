/// A public 7TV ranking the discovery browser shows.
public enum DiscoveryMode: String, CaseIterable, Sendable {
  /// All-time most used emotes.
  case top
  /// This week's trending emotes.
  case trending

  /// The 7TV GraphQL sort key.
  var sortKey: String {
    switch self {
    case .top:
      "TOP_ALL_TIME"

    case .trending:
      "TRENDING_WEEKLY"
    }
  }
}
