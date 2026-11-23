/// The impact of restoring a particular revision.
public struct CatalogRestorePreview: Decodable, Sendable {
  /// The revision that must still be current when the restore is confirmed.
  public let currentRevision: UInt64
  /// The revision selected for restoration.
  public let targetRevision: UInt64
  /// Names of emotes to add.
  public let added: [String]
  /// Names of emotes to remove.
  public let removed: [String]
  /// Names of emotes with changed details.
  public let updated: [String]
  /// Whether the precedence of retained emotes changes.
  public let orderChanged: Bool
  /// The current saved policy.
  public let currentSettings: EmotePolicy
  /// The policy selected for restoration.
  public let restoredSettings: EmotePolicy

  /// Whether confirming this preview would change the catalog.
  public var hasChanges: Bool {
    !added.isEmpty || !removed.isEmpty || !updated.isEmpty || orderChanged
      || currentSettings != restoredSettings
  }
}
