/// One player's row in the scoreboard.
public struct GameScore: Decodable, Equatable, Identifiable, Sendable {
  /// The player's Discord account ID.
  public let id: String
  /// Points in the current or last match.
  public let score: Int

  /// Creates a scoreboard row.
  ///
  /// - Parameters:
  ///   - id: The Discord account ID.
  ///   - score: The player's points.
  public init(id: String, score: Int) {
    self.id = id
    self.score = score
  }
}
