/// A response that only carries a message, such as an add or remove confirmation.
struct MessageResponse: Decodable {
  /// What happened, suitable for showing.
  let message: String
}
