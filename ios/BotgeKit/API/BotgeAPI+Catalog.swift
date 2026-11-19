import Foundation

extension BotgeAPI {
  /// Most emotes one batch request may change; the server enforces the same limit.
  public static let maxBatch = 12

  /// Loads a server's catalog and the member's emote permissions.
  ///
  /// - Parameter guild: The Discord server ID.
  /// - Returns: The emotes and the member's permissions.
  /// - Throws: ``APIError`` for rejected, failed, or malformed requests.
  public func catalog(guild: String) async throws(APIError) -> Catalog {
    try await post("catalog", body: GuildRequest(guildID: guild))
  }

  /// Adds a 7TV emote to the server and returns the server's confirmation.
  ///
  /// - Parameters:
  ///   - guild: The Discord server ID.
  ///   - sevenTVID: The 7TV emote ID.
  /// - Returns: The server's confirmation message.
  /// - Throws: ``APIError/rejected(_:)`` for a name or ID conflict or a full list, and other
  ///   ``APIError`` cases for failed requests.
  public func addEmote(guild: String, sevenTVID: String) async throws(APIError) -> String {
    let body = EmoteRequest(guildID: guild, emoteID: sevenTVID)
    let response: MessageResponse = try await post("emotes", body: body)
    return response.message
  }

  /// Removes an individually added 7TV emote from the server.
  ///
  /// - Parameters:
  ///   - guild: The Discord server ID.
  ///   - sevenTVID: The 7TV emote ID.
  /// - Returns: The server's confirmation message.
  /// - Throws: ``APIError/notFound(_:)`` when the server never added it, and other
  ///   ``APIError`` cases for failed requests.
  public func removeEmote(guild: String, sevenTVID: String) async throws(APIError) -> String {
    let body = EmoteRequest(guildID: guild, emoteID: sevenTVID)
    let response: MessageResponse = try await post("emotes/remove", body: body)
    return response.message
  }

  /// Applies `action` to up to ``maxBatch`` distinct 7TV emotes, one result per ID in order.
  ///
  /// Each item is saved independently, so failed items can be retried alone.
  ///
  /// - Parameters:
  ///   - guild: The Discord server ID.
  ///   - action: The change to apply.
  ///   - sevenTVIDs: Distinct 7TV emote IDs, at most `maxBatch`.
  /// - Returns: One result per ID, in request order.
  /// - Throws: ``APIError/rejected(_:)`` for an empty, oversized or duplicated list, and other
  ///   ``APIError`` cases when the whole request fails.
  public func changeEmotes(guild: String, action: EmoteAction, sevenTVIDs: [String])
    async throws(APIError) -> [EmoteChange]
  {
    guard (1 ... Self.maxBatch).contains(sevenTVIDs.count),
          Set(sevenTVIDs).count == sevenTVIDs.count
    else {
      throw .rejected("Choose between 1 and \(Self.maxBatch) different emotes.")
    }

    let body = BatchRequest(guildID: guild, action: action, emoteIDs: sevenTVIDs)
    return try await post("emotes/batch", body: body)
  }

  /// Issues a one-use ticket for a catalog watch connection.
  ///
  /// - Parameter guild: The Discord server ID.
  /// - Returns: The ticket to present in the connection's first message.
  /// - Throws: ``APIError`` for rejected or failed requests.
  func watchTicket(guild: String) async throws(APIError) -> String {
    let response: WatchTicket = try await post(
      "catalog/watch",
      body: GuildRequest(guildID: guild)
    )
    return response.ticket
  }

  /// The WebSocket URL for `path`, using `wss` for HTTPS deployments.
  ///
  /// - Parameter path: The route below the API base URL.
  /// - Returns: The `ws` or `wss` URL, or `nil` if the base URL cannot be converted.
  func socketURL(_ path: String) -> URL? {
    let url = baseURL.appending(path: path)
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return nil
    }

    components.scheme = url.scheme == "https" ? "wss" : "ws"
    return components.url
  }
}
