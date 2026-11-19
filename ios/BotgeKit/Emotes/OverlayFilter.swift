/// Narrows a catalog by whether emotes draw over others.
public enum OverlayFilter: String, CaseIterable, Sendable {
  /// Every emote.
  case any
  /// Only overlay emotes.
  case overlaying
  /// Only regular emotes.
  case regular
}
