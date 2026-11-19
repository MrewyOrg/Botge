/// Narrows a catalog by animation.
public enum MotionFilter: String, CaseIterable, Sendable {
  /// Only animated emotes.
  case animated
  /// Every emote.
  case any
  /// Only still emotes.
  case still
}
