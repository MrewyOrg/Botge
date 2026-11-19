/// How a finished match ended.
public enum MatchResult: Equatable, Sendable {
  /// Nobody scored a point.
  case nobodyScored
  /// Two or more players share the highest score.
  case tie
  /// One player has the highest score.
  case won(player: String)
}
