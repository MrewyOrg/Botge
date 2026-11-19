/// A message from a Guess room.
public enum GameMessage: Decodable, Equatable, Sendable {
  /// The room refused the connection; the text explains why.
  case error(String)
  /// The room changed.
  case state(GameState)
  /// The local player's last guess was wrong.
  case wrong

  private enum CodingKeys: String, CodingKey {
    case message
    case state
    case type
  }

  /// Decodes a message by its `type`.
  ///
  /// - Parameter decoder: The message decoder.
  /// - Throws: `DecodingError` for an unknown type or a malformed body.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decode(String.self, forKey: .type)
    switch type {
    case "state":
      self = try .state(container.decode(GameState.self, forKey: .state))

    case "wrong":
      self = .wrong

    case "error":
      self = try .error(container.decode(String.self, forKey: .message))

    default:
      throw DecodingError.dataCorruptedError(
        forKey: .type,
        in: container,
        debugDescription: "Unknown game message type."
      )
    }
  }
}
