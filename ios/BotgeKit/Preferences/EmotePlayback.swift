/// When animated emotes play.
public enum EmotePlayback: String, CaseIterable, Sendable {
  /// Always animate.
  case always
  /// Animate unless the system Reduce Motion setting is on.
  case followReduceMotion
  /// Never animate; show the first frame.
  case never

  /// Whether to animate given the current Reduce Motion setting.
  ///
  /// - Parameter reduceMotion: Whether the system Reduce Motion setting is on.
  /// - Returns: Whether emotes should animate.
  public func animates(reduceMotion: Bool) -> Bool {
    switch self {
    case .always:
      true

    case .followReduceMotion:
      !reduceMotion

    case .never:
      false
    }
  }
}
