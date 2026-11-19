/// The change a batch applies to every listed 7TV emote.
public enum EmoteAction: String, Encodable, Sendable {
  /// Add each emote to the server.
  case add
  /// Remove each individually added emote.
  case remove
}
