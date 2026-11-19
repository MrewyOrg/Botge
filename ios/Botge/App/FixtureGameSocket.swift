#if DEBUG
import BotgeKit
import Foundation
import Synchronization

/// A scripted one-round Guess room for UI tests and fixture runs.
///
/// Joining shows the lobby with one other player. Starting plays a single round whose answer
/// is `catJAM`; a correct guess wins it, any other guess is wrong, and the match then ends.
actor FixtureGameSocket: MessageSocket {
  /// The local player's ID, matching the fixture ticket.
  static let player = "100000000000000042"
  /// The other fixture player's ID.
  private static let rival = "100000000000000077"
  /// The answer of the fixture round.
  private static let answer = "catJAM"
  /// How often ``receive()`` checks for a message, in milliseconds.
  private static let pollMilliseconds = 50
  /// How often ``receive()`` checks for a message.
  private static let pollInterval: Duration = .milliseconds(pollMilliseconds)
  /// How long the reveal stays before the match ends, in seconds.
  private static let revealSeconds = 2
  /// How long the reveal stays before the match ends.
  private static let revealPause: Duration = .seconds(revealSeconds)
  /// The pause between scripted phases.
  private static let beat: Duration = .seconds(1)
  /// The round length the fixture reports, in milliseconds.
  private static let roundMilliseconds = 20_000
  /// The ready beat the fixture reports, in milliseconds.
  private static let readyMilliseconds = 1_000
  /// Points for the fixture round.
  private static let points = 10
  /// The other player's score.
  private static let rivalScore = 4

  /// Messages waiting to be received, and whether the socket is closed.
  private let queue: Mutex = .init((messages: [String](), isClosed: false))

  /// The round state, with the local player's score.
  ///
  /// - Parameters:
  ///   - phase: The phase name.
  ///   - score: The local player's score.
  ///   - extra: Extra state fields as JSON members.
  /// - Returns: The `state` message.
  private static func state(_ phase: String, score: Int = 0, extra: String = "") -> String {
    let players = [(player, score), (rival, rivalScore)]
      .sorted { $0.1 > $1.1 }
      .map { #"{"id":"\#($0.0)","score":\#($0.1)}"# }
      .joined(separator: ",")
    let round = phase == "lobby" ? 0 : 1
    return #"{"type":"state","state":{"phase":"\#(phase)","round":\#(round),"rounds":1,"#
      + #""roundMs":\#(roundMilliseconds),"players":[\#(players)],"guesses":[]\#(extra)}}"#
  }

  /// Answers the room protocol.
  ///
  /// - Parameter text: A `join`, `start` or `guess` command.
  nonisolated func send(_ text: String) async {
    let command = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: String]
    switch command?["type"] {
    case "join":
      push(Self.state("lobby"))

    case "start":
      push(Self.state("loading"))
      try? await Task.sleep(for: Self.beat)
      push(Self.state(
        "ready",
        extra: #","remainingMs":\#(Self.readyMilliseconds),"image":"fixture""#
      ))
      try? await Task.sleep(for: Self.beat)
      push(Self.state(
        "round",
        extra: #","remainingMs":\#(Self.roundMilliseconds),"image":"fixture","hint":"c_t_A_""#
      ))

    case "guess" where command?["text"]?.caseInsensitiveCompare(Self.answer) == .orderedSame:
      push(Self.state(
        "reveal",
        score: Self.points,
        extra: #","remainingMs":3000,"image":"fixture","answer":"\#(Self.answer)","#
          + #""winner":"\#(Self.player)","points":\#(Self.points)"#
      ))
      try? await Task.sleep(for: Self.revealPause)
      push(Self.state("final", score: Self.points))

    case "guess":
      push(#"{"type":"wrong"}"#)

    default:
      break
    }
  }

  /// Waits for the next scripted message.
  ///
  /// - Returns: The message.
  /// - Throws: `URLError(.networkConnectionLost)` once the socket is closed.
  nonisolated func receive() async throws -> String {
    while true {
      let next = queue.withLock { state -> String?? in
        if state.isClosed {
          return .some(nil)
        }
        return state.messages.isEmpty ? nil : .some(state.messages.removeFirst())
      }
      switch next {
      case let .some(.some(message)):
        return message

      case .some(.none):
        throw URLError(.networkConnectionLost)

      case .none:
        try await Task.sleep(for: Self.pollInterval)
      }
    }
  }

  /// Closes the socket.
  nonisolated func close() {
    queue.withLock { $0.isClosed = true }
  }

  /// Queues a message for ``receive()``.
  ///
  /// - Parameter message: The message text.
  private nonisolated func push(_ message: String) {
    queue.withLock { $0.messages.append(message) }
  }
}
#endif
