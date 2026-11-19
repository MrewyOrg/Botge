/// A one-use ticket for a Guess room connection, from `POST /game/join`.
struct GameTicket: Decodable {
  private enum CodingKeys: String, CodingKey {
    case ticket
    case userID = "userId"
  }

  /// Presented in the connection's first message within 30 seconds.
  let ticket: String
  /// The signed-in user's Discord account ID, to find their row in the scoreboard.
  let userID: String
}
