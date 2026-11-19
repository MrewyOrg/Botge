import BotgeKit

/// Loaded 7TV discovery results and paging for one ranking.
struct DiscoveryState {
  /// The search and filters the loaded pages match.
  var filter: EmoteFilter = .init()
  /// Results so far, without server state.
  var emotes: [CatalogEmote] = []
  /// The last loaded page, or 0 before the first.
  var page = 0
  /// The page count 7TV reported.
  var pageCount = 0
  /// Whether a page is loading.
  var isLoading = false
  /// Why the last page failed, if it did.
  var failure: APIError?

  /// Whether 7TV has more pages.
  var hasMore: Bool {
    page < pageCount
  }

  /// Whether the results already answer `wanted`, so showing them needs no request.
  ///
  /// - Parameter wanted: The search and filters to show.
  /// - Returns: Whether the state is loaded, loading or failed for `wanted`.
  func isCurrent(for wanted: EmoteFilter) -> Bool {
    filter == wanted && (page > 0 || isLoading || failure != nil)
  }
}
