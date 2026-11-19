import BotgeKit

/// What a discovery search depends on; a change restarts the search.
struct DiscoveryRequest: Equatable {
  /// The selected source.
  let source: EmotesSource
  /// The search and filter settings.
  let filter: EmoteFilter
}
