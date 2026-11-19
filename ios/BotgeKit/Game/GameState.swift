public import Foundation

/// A Guess room as every player sees it, from the room's `state` message.
///
/// Remaining time counts from the moment the server sent the state, so the app never compares
/// its clock with the server's.
public struct GameState: Decodable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case answer
    case guesses
    case hint
    case image
    case notice
    case phase
    case players
    case points
    case remainingMilliseconds = "remainingMs"
    case round
    case roundMilliseconds = "roundMs"
    case rounds
    case winner
  }

  /// Blur radius when a round starts, matching the Activity.
  public static let startBlur = 28.0
  /// Blur radius when a round's time runs out.
  public static let endBlur = 3.0
  /// Milliseconds per second.
  static let millisecondsPerSecond = 1_000.0

  /// Where the match is.
  public let phase: GamePhase
  /// The current round, from 1; 0 before the first round.
  public let round: Int
  /// Rounds in this match.
  public let rounds: Int
  /// The random token of the round image, from the ready beat until the reveal ends.
  public let image: String?
  /// Milliseconds until the ready beat, round or reveal ends, when it sent the state.
  public let remainingMilliseconds: Int?
  /// The full length of a round in milliseconds.
  public let roundMilliseconds: Int
  /// The emote name with hidden letters as underscores, while the round is open.
  public let hint: String?
  /// The emote's name, during the reveal.
  public let answer: String?
  /// The player who named the emote, during the reveal; `nil` when time ran out.
  public let winner: String?
  /// Points the winner earned this round.
  public let points: Int?
  /// Players by score, highest first.
  public let players: [GameScore]
  /// The round's most recent wrong guesses, oldest first.
  public let guesses: [GameGuess]
  /// Why the last match could not start.
  public let notice: String?

  /// Seconds until the current phase ends, or `nil` when it has no deadline.
  public var remaining: TimeInterval? {
    remainingMilliseconds.map { Double($0) / Self.millisecondsPerSecond }
  }

  /// The full length of a round in seconds.
  public var roundLength: TimeInterval {
    Double(roundMilliseconds) / Self.millisecondsPerSecond
  }

  /// How the match ended, once it is final.
  public var result: MatchResult? {
    guard phase == .final else {
      return nil
    }
    guard let first = players.first, first.score > 0 else {
      return .nobodyScored
    }

    if players.count > 1, players[1].score == first.score {
      return .tie
    }
    return .won(player: first.id)
  }

  /// Creates a state; the server normally sends it.
  ///
  /// - Parameters:
  ///   - phase: Where the match is.
  ///   - round: The current round.
  ///   - rounds: Rounds in the match.
  ///   - roundMilliseconds: The length of a round.
  ///   - players: The scoreboard.
  ///   - remainingMilliseconds: Time left in the phase.
  ///   - image: The round image token.
  ///   - hint: The masked name.
  ///   - answer: The revealed name.
  ///   - winner: Who named it.
  ///   - points: The winner's points.
  ///   - guesses: Recent wrong guesses.
  ///   - notice: Why a match could not start.
  public init(
    phase: GamePhase,
    round: Int = 0,
    rounds: Int = 0,
    roundMilliseconds: Int = 0,
    players: [GameScore] = [],
    remainingMilliseconds: Int? = nil,
    image: String? = nil,
    hint: String? = nil,
    answer: String? = nil,
    winner: String? = nil,
    points: Int? = nil,
    guesses: [GameGuess] = [],
    notice: String? = nil
  ) {
    self.phase = phase
    self.round = round
    self.rounds = rounds
    self.roundMilliseconds = roundMilliseconds
    self.players = players
    self.remainingMilliseconds = remainingMilliseconds
    self.image = image
    self.hint = hint
    self.answer = answer
    self.winner = winner
    self.points = points
    self.guesses = guesses
    self.notice = notice
  }

  /// Decodes a state, treating missing guesses as none, like the Activity.
  ///
  /// - Parameter decoder: The message decoder.
  /// - Throws: `DecodingError` when a field is missing, negative or has the wrong type.
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    phase = try container.decode(GamePhase.self, forKey: .phase)
    round = try Self.count(container, .round)
    rounds = try Self.count(container, .rounds)
    roundMilliseconds = try Self.count(container, .roundMilliseconds)
    players = try container.decode([GameScore].self, forKey: .players)
    guesses = try container.decodeIfPresent([GameGuess].self, forKey: .guesses) ?? []
    remainingMilliseconds = try container.decodeIfPresent(Int.self, forKey: .remainingMilliseconds)
      .map { max($0, 0) }
    image = try container.decodeIfPresent(String.self, forKey: .image)
    hint = try container.decodeIfPresent(String.self, forKey: .hint)
    answer = try container.decodeIfPresent(String.self, forKey: .answer)
    winner = try container.decodeIfPresent(String.self, forKey: .winner)
    points = try container.decodeIfPresent(Int.self, forKey: .points)
    notice = try container.decodeIfPresent(String.self, forKey: .notice)
  }

  /// The blur radius for a round image with `remaining` seconds left, easing from
  /// ``startBlur`` to ``endBlur`` over the round, as in the Activity.
  ///
  /// - Parameters:
  ///   - remaining: Seconds left in the round.
  ///   - length: The round length in seconds.
  /// - Returns: The blur radius.
  public static func blur(remaining: TimeInterval, length: TimeInterval) -> Double {
    let left = length <= 0 ? 0 : min(1, max(0, remaining / length))
    return endBlur + (startBlur - endBlur) * left
  }

  /// The player's place in the scoreboard, from 1; players with equal scores share a place.
  ///
  /// - Parameter player: A Discord account ID.
  /// - Returns: The place, or `nil` when the player has no row.
  public func rank(of player: String) -> Int? {
    guard let score = players.first(where: { $0.id == player })?.score else {
      return nil
    }

    return players.count { $0.score > score } + 1
  }

  /// When the current phase ends, measured from when the state arrived.
  ///
  /// - Parameter received: When the state arrived.
  /// - Returns: The deadline, or `nil` when the phase has none.
  public func deadline(from received: Date) -> Date? {
    remaining.map { received.addingTimeInterval($0) }
  }

  /// Decodes a required non-negative whole number.
  ///
  /// - Parameters:
  ///   - container: The state container.
  ///   - key: The field.
  /// - Returns: The number.
  /// - Throws: `DecodingError` when the field is missing, not a number or negative.
  private static func count(_ container: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys)
    throws -> Int
  {
    let value = try container.decode(Int.self, forKey: key)
    guard value >= 0 else {
      throw DecodingError.dataCorruptedError(
        forKey: key,
        in: container,
        debugDescription: "Expected a non-negative count."
      )
    }

    return value
  }
}
