public import ActivityKit
public import Foundation

/// The Guess game's Live Activity, shared by the app (which starts and updates it) and the widget
/// extension (which draws it). It is updated locally; no push server is involved.
public struct GuessActivityAttributes: ActivityAttributes {
  /// Values that change during a match.
  public struct ContentState: Codable, Hashable, Sendable {
    /// The current round, starting at 1.
    public var round: Int
    /// When the current round's guessing time ends.
    public var roundEndsAt: Date
    /// The local player's score.
    public var score: Int
    /// The local player's rank, starting at 1.
    public var rank: Int

    /// Creates a state snapshot.
    ///
    /// - Parameters:
    ///   - round: The current round, from 1.
    ///   - roundEndsAt: When guessing ends.
    ///   - score: The local player's score.
    ///   - rank: The local player's rank, from 1.
    public init(round: Int, roundEndsAt: Date, score: Int, rank: Int) {
      self.round = round
      self.roundEndsAt = roundEndsAt
      self.score = score
      self.rank = rank
    }
  }

  /// The server's display name.
  public var serverName: String
  /// Rounds in the match.
  public var rounds: Int

  /// Creates the fixed attributes for a match.
  ///
  /// - Parameters:
  ///   - serverName: The server's display name.
  ///   - rounds: Rounds in the match.
  public init(serverName: String, rounds: Int) {
    self.serverName = serverName
    self.rounds = rounds
  }
}
