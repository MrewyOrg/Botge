import Foundation

/// The GraphQL request body for one page of 7TV discovery results.
struct SevenTVSearchRequest: Encodable {
  /// The query's variables.
  struct Variables: Encodable {
    /// Trimmed search text; empty matches every emote.
    let query: String
    /// The one-based page number.
    let page: Int
    /// Results per page.
    let perPage: Int
    /// The ranking.
    let sort: Sort
    /// Flag filters 7TV applies.
    let filters: SevenTVSearchFilters
    /// Tags every result must have; omitted when there are none.
    let tags: Tags?
  }

  /// A ranking and its direction.
  struct Sort: Encodable {
    /// The 7TV sort key, such as `TRENDING_WEEKLY`.
    let sortBy: String
    /// `DESCENDING`: most popular first.
    let order: String
  }

  /// Required tags.
  struct Tags: Encodable {
    /// `ALL`: every tag must match.
    let match: String
    /// Lowercased tag terms.
    let tags: [String]
  }

  /// The GraphQL query text.
  let query: String
  /// The query's variables.
  let variables: Variables

  /// Builds the request for one page of a ranking.
  ///
  /// The filter's search text, motion, overlay and tag terms apply; source and added-only filters
  /// do not, because every result is a 7TV emote the server may not have.
  ///
  /// - Parameters:
  ///   - mode: The ranking.
  ///   - page: The one-based page number.
  ///   - filter: The search and filter settings.
  init(_ mode: DiscoveryMode, page: Int, filter: EmoteFilter) {
    query = DiscoveryParser.query
    variables = Variables(
      query: filter.query.trimmingCharacters(in: .whitespaces),
      page: page,
      perPage: SevenTVDiscovery.pageSize,
      sort: Sort(sortBy: mode.sortKey, order: "DESCENDING"),
      filters: SevenTVSearchFilters(motion: filter.motion, overlay: filter.overlay),
      tags: filter.tagTerms.isEmpty ? nil : Tags(match: "ALL", tags: filter.tagTerms)
    )
  }
}
