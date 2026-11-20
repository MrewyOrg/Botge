@testable import Botge
import BotgeKit
import Foundation
import Testing
import ViewInspector

struct LiveActivityViewTests {
  private static let attributes: GuessActivityAttributes = .init(
    serverName: "Fixture Server",
    rounds: 5
  )
  private static let state = GuessActivityAttributes.ContentState(
    round: 2,
    roundEndsAt: .now.addingTimeInterval(20),
    score: 7,
    rank: 1
  )

  @Test
  func `the Lock Screen names the server, round and score`() async throws {
    let banner = GuessActivityViews.lockScreen(attributes: Self.attributes, state: Self.state)
    #expect(throws: Never.self) { try banner.inspect().find(text: "Round 2 of 5") }
    #expect(throws: Never.self) { try banner.inspect().find(text: "7 pts · #1") }
    await Hosting.show(banner, model: Fixtures.misconfigured())
  }

  @Test
  func `the Dynamic Island and its link open the Guess tab`() {
    _ = GuessActivityViews.island(attributes: Self.attributes, state: Self.state)
    #expect(GuessActivityViews.guessURL?.host() == "guess")
    let ended = GuessActivityViews.countdown(to: .distantPast)
    #expect(throws: Never.self) { try ended.inspect().text() }
  }
}
