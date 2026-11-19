public import Foundation

extension GuessActivityAttributes.ContentState {
  /// The Live Activity content for a room state, or `nil` outside a running round.
  ///
  /// The countdown targets the end of the round: during the ready beat it includes the coming
  /// round, and during the reveal it has already ended.
  ///
  /// - Parameters:
  ///   - state: The room state.
  ///   - player: The local player's Discord account ID.
  ///   - received: When the state arrived.
  public init?(state: GameState, player: String, received: Date) {
    let end: Date
    switch state.phase {
    case .ready:
      end = received.addingTimeInterval((state.remaining ?? 0) + state.roundLength)

    case .round:
      end = state.deadline(from: received) ?? received

    case .reveal:
      end = received

    case .final, .loading, .lobby:
      return nil
    }

    self.init(
      round: max(state.round, 1),
      roundEndsAt: end,
      score: state.players.first { $0.id == player }?.score ?? 0,
      rank: state.rank(of: player) ?? state.players.count + 1
    )
  }
}
