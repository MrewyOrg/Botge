/// One entry in a server's catalog history.
public struct CatalogRevision: Decodable, Identifiable, Sendable {
  /// The action that produced the revision.
  public struct Edit: Decodable, Sendable {
    /// An addition, removal, settings save, starting record, or restore.
    public let type: String
    /// The source revision for a restore.
    public let revision: UInt64?
    /// The emote name saved with an addition or removal.
    public let name: String?
  }

  private enum CodingKeys: String, CodingKey {
    case revision
    case recordedAt
    case edit
    case actorID = "actorId"
  }

  /// The revision number within this guild.
  public let revision: UInt64
  /// Unix seconds when the revision was recorded.
  public let recordedAt: UInt64
  /// Discord user ID, when available.
  public let actorID: String?
  /// The change recorded by the server.
  public let edit: Edit
  /// The stable identity used by the revision list.
  public var id: UInt64 {
    revision
  }
}
