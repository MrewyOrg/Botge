/// The outcome of one item in a batch emote change.
public struct EmoteChange: Decodable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case emoteID = "emoteId"
    case message
    case succeeded = "ok"
  }

  /// The 7TV emote ID the item named.
  public let emoteID: String
  /// Whether the change was saved.
  public let succeeded: Bool
  /// What happened, suitable for showing.
  public let message: String
}
