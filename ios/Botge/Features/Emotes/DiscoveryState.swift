import BotgeKit

/// Loaded 7TV discovery results and paging.
struct DiscoveryState {
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
}
