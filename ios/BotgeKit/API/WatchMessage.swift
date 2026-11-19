/// A message on the catalog watch connection: `watching`, `changed`, or `error`.
struct WatchMessage: Decodable {
  /// The message kind.
  let type: String
}
