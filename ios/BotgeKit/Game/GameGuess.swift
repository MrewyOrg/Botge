/// A wrong guess shown to the whole room.
public struct GameGuess: Decodable, Equatable, Sendable {
  /// The Discord account ID of the player who guessed.
  public let id: String
  /// The guess, shortened by the server to 40 characters.
  public let text: String

  /// Creates a shared guess.
  ///
  /// - Parameters:
  ///   - id: The guessing player's Discord account ID.
  ///   - text: The guess.
  public init(id: String, text: String) {
    self.id = id
    self.text = text
  }
}
