import Foundation

/// Fetches public 7TV discovery pages and accepts only safe, well-formed entries.
///
/// Requests go straight from the device to 7TV, as the Activity does outside Discord. Entries
/// must be public, listed, non-private and non-NSFW, with images on 7TV's CDN.
public struct SevenTVDiscovery: Sendable {
  /// Results per page, matching the Activity.
  public static let pageSize = 24
  /// The 7TV GraphQL endpoint.
  static let endpoint: URL = .init(literal: "https://7tv.io/v4/gql")

  /// Sends requests.
  private let transport: any HTTPTransport

  /// Creates a client.
  ///
  /// - Parameter transport: Sends requests to 7TV.
  public init(transport: any HTTPTransport) {
    self.transport = transport
  }

  /// Fetches one page of a ranking, filtered on 7TV's side.
  ///
  /// The filter's search text, motion, overlay and tag terms apply; source and added-only filters
  /// do not, because every result is a 7TV emote the server may not have.
  ///
  /// - Parameters:
  ///   - mode: The ranking.
  ///   - page: The one-based page number.
  ///   - filter: The search and filter settings.
  /// - Returns: The accepted emotes and the page count.
  /// - Throws: ``APIError/network`` when 7TV cannot be reached, ``APIError/unavailable(_:)`` for
  ///   an error status, and ``APIError/malformedResponse`` for an invalid page.
  public func page(_ mode: DiscoveryMode, number page: Int, filter: EmoteFilter)
    async throws(APIError) -> DiscoveryPage
  {
    let request = SevenTVSearchRequest(mode, page: page, filter: filter)
    guard let body = try? JSONEncoder().encode(request) else {
      throw .malformedResponse
    }

    var urlRequest = URLRequest(url: Self.endpoint)
    urlRequest.httpMethod = "POST"
    urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
    urlRequest.httpBody = body
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await transport.data(for: urlRequest)
    } catch {
      throw .network
    }
    guard let status = (response as? HTTPURLResponse)?.statusCode,
          HTTPStatus.success.contains(status)
    else {
      throw .unavailable(String(localized: "7TV is unavailable. Try again shortly."))
    }

    return try DiscoveryParser.page(from: data)
  }
}
