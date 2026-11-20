@testable import Botge
import BotgeKit
import SwiftUI
import Testing

struct HelperTests {
  @Test
  func `every haptic kind has system feedback`() {
    let kinds: [HapticEvent.Kind] = [.failure, .impact, .selection, .success, .warning]
    let feedback = kinds.map { HapticEvent($0, after: nil).feedback }
    #expect(feedback == [.error, .impact(weight: .light), .selection, .success, .warning])
  }

  @Test
  func `appearance preferences map to color schemes and titles`() {
    let preferences: [AppearancePreference] = [.system, .light, .dark]
    #expect(preferences.map(\.colorScheme) == [nil, .light, .dark])
    #expect(Set(preferences.map { String(localized: $0.title) }).count == 3)
  }

  @Test
  func `optional text binds as text`() {
    var stored: String?
    let binding = Binding<String?> { stored } set: { stored = $0 }
    #expect(binding.orEmpty.wrappedValue.isEmpty)
    binding.orEmpty.wrappedValue = "hi"
    #expect(stored == "hi")
  }

  @Test
  func `colors outside sRGB clamp to border channels`() {
    let wide = Color(.displayP3, red: 1, green: 0, blue: 0)
    let border = BorderColor(wide)
    #expect(border.red == 255 && border.green == 0)
  }

  @Test
  func `room statuses follow the phase in the Activity's words`() {
    let local = "100000000000000042"
    let rival = "100000000000000077"
    let alone = GameState(phase: .lobby, players: [GameScore(id: local, score: 0)])
    let crowd = GameState(phase: .lobby, players: [
      GameScore(id: local, score: 0),
      GameScore(id: rival, score: 0)
    ])
    let refused = GameState(phase: .lobby, notice: "Not enough emotes.")
    #expect(alone.status(player: local).contains("only player"))
    #expect(crowd.status(player: local).contains("2"))
    #expect(refused.status(player: local) == "Not enough emotes.")
    for phase in [GamePhase.loading, .ready, .round] {
      #expect(!GameState(phase: phase).status(player: local).isEmpty)
    }

    let timedOut = GameState(phase: .reveal, answer: "catJAM")
    #expect(GameState(phase: .reveal).status(player: local).contains("Time is up"))
    let mine = GameState(phase: .reveal, answer: "catJAM", winner: local, points: 3)
    let theirs = GameState(phase: .reveal, answer: "catJAM", winner: rival)
    #expect(timedOut.status(player: local).contains("Time is up"))
    #expect(mine.status(player: local).contains("+3"))
    #expect(theirs.status(player: local).contains("0077"))

    let won = GameState(phase: .final, players: [
      GameScore(id: local, score: 5),
      GameScore(id: rival, score: 1)
    ])
    let lost = GameState(phase: .final, players: [
      GameScore(id: rival, score: 5),
      GameScore(id: local, score: 1)
    ])
    let tie = GameState(phase: .final, players: [
      GameScore(id: rival, score: 5),
      GameScore(id: local, score: 5)
    ])
    let empty = GameState(phase: .final, players: [GameScore(id: local, score: 0)])
    #expect(won.status(player: local).contains("You win"))
    #expect(lost.status(player: local).contains("0077"))
    #expect(tie.status(player: local).contains("tie"))
    #expect(empty.status(player: local).contains("Nobody"))
  }
}
