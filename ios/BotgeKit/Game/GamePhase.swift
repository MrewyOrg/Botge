/// Where a Guess room is in its match.
public enum GamePhase: String, Decodable, Sendable {
  /// The match is over; the scoreboard is final.
  case final
  /// Botge is picking emotes and loading their images.
  case loading
  /// Waiting for someone to start a match.
  case lobby
  /// A short pause before a round; the round image is loading.
  case ready
  /// The answer is shown before the next round.
  case reveal
  /// Players are guessing the emote.
  case round

  /// Whether a match is running, from loading through the last reveal.
  public var isPlaying: Bool {
    switch self {
    case .loading, .ready, .reveal, .round:
      true

    case .final, .lobby:
      false
    }
  }
}
