extension BotgeAPI {
  private struct CatalogRevisionRequest: Encodable {
    let guildId: String
    let revision: UInt64
    let expectedRevision: UInt64?
  }

  private struct CatalogRestoreResult: Decodable {
    let currentRevision: UInt64
  }

  /// Lists saved catalog revisions for a guild administrator.
  ///
  /// - Parameter guild: The Discord server ID.
  /// - Returns: The retained catalog history.
  /// - Throws: ``APIError`` for denied or failed requests.
  public func catalogHistory(guild: String) async throws(APIError) -> CatalogHistory {
    try await post("catalog/history", body: GuildRequest(guildID: guild))
  }

  /// Describes what would change if a saved revision were restored.
  ///
  /// - Parameters:
  ///   - revision: The selected older revision.
  ///   - guild: The Discord server ID.
  /// - Returns: The diff and current revision needed to confirm it.
  /// - Throws: ``APIError`` if the request fails or the revision is unavailable.
  public func previewCatalogRestore(revision: UInt64, guild: String)
    async throws(APIError) -> CatalogRestorePreview
  {
    try await post("catalog/history/preview", body: CatalogRevisionRequest(
      guildId: guild, revision: revision, expectedRevision: nil
    ))
  }

  /// Restores a preview while the guild's catalog remains at its expected revision.
  ///
  /// - Parameters:
  ///   - preview: The administrator's selected preview.
  ///   - guild: The Discord server ID.
  /// - Returns: The new current revision.
  /// - Throws: ``APIError`` if permission changes, the preview is stale, or the request fails.
  public func restoreCatalog(_ preview: CatalogRestorePreview, guild: String)
    async throws(APIError) -> UInt64
  {
    let result: CatalogRestoreResult = try await post(
      "catalog/history/restore",
      body: CatalogRevisionRequest(
        guildId: guild, revision: preview.targetRevision, expectedRevision: preview.currentRevision
      )
    )
    return result.currentRevision
  }
}
