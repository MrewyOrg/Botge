/// The retained history of one server's managed catalog.
public struct CatalogHistory: Decodable, Sendable {
  /// The currently saved revision number.
  public let currentRevision: UInt64
  /// Retained revisions in newest-first order.
  public let revisions: [CatalogRevision]
}
