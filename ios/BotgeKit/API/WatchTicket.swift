/// A one-use ticket that opens one catalog watch connection.
struct WatchTicket: Decodable {
  /// Presented in the connection's first message.
  let ticket: String
}
