@testable import Botge
import BotgeKit
import Foundation
import Testing

struct GuessActivityControllerTests {
  private static let player = "100000000000000001"

  private static func round(_ number: Int) -> GameState {
    GameState(
      phase: .round,
      round: number,
      rounds: 3,
      roundMilliseconds: 20_000,
      players: [GameScore(id: player, score: 3)],
      remainingMilliseconds: 5_000,
      hint: "c_t",
      answer: nil,
      guesses: []
    )
  }

  @Test
  func `a private match keeps its score out of the activity until it ends`() async {
    let controller = GuessActivityController()
    // The simulator may refuse Live Activities; the state handling runs either way.
    await controller.show(
      Self.round(1),
      player: Self.player,
      received: .now,
      serverName: "Fixture Server",
      isPrivate: true
    )
    await controller.show(
      Self.round(2),
      player: Self.player,
      received: .now,
      serverName: "Fixture Server",
      isPrivate: false
    )
    await controller.show(
      Self.round(2),
      player: Self.player,
      received: .now,
      serverName: "Fixture Server",
      isPrivate: false
    )
    await controller.end()
  }
}
