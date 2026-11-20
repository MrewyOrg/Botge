@testable import Botge
import BotgeKit
import SwiftUI
import Testing
import ViewInspector

struct GuessViewTests {
  private static let player: String = FixtureGameSocket.player
  private static let rival = "100000000000000077"

  private static func model(open: Bool = true) async throws -> GuessModel {
    let app = await Fixtures.signedIn()
    let model = GuessModel(guild: Fixtures.guild, app: app, firstReconnectDelay: .milliseconds(1))
    if open {
      try model.open(#require(GameRoomCode("K7QF2M")))
    }
    return model
  }

  private static func state(
    _ phase: GamePhase,
    remaining: Int? = 5_000,
    answer: String? = "cat"
  )
    -> GameState
  {
    GameState(
      phase: phase,
      round: 1,
      rounds: 3,
      roundMilliseconds: 20_000,
      players: [GameScore(id: player, score: 3), GameScore(id: rival, score: 1)],
      remainingMilliseconds: remaining,
      hint: "c_t",
      answer: phase == .reveal ? answer : nil,
      guesses: [GameGuess(id: rival, text: "dog")]
    )
  }

  @Test
  func `the tab offers to create or join a room until one is open`() async throws {
    let model = try await Self.model(open: false)
    let view = GuessView(model: model).environment(model.app)
    try view.inspect().find(button: "Create a Room").tap()
    #expect(model.room != nil)
    try GuessStartView(model: model).inspect().find(ViewType.TextField.self).callOnSubmit()
    #expect(throws: Never.self) { try view.inspect().find(GuessRoomView.self) }
    await Hosting.show(NavigationStack { view }, model: model.app) {
      model.retry()
      try? model.open(#require(GameRoomCode("AB")))
    }
  }

  @Test
  func `rooms show joining, failures and the match`() async throws {
    let model = try await Self.model()
    let room = try #require(model.room)
    let view = GuessRoomView(model: model, room: room).environment(model.app)
    #expect(throws: Never.self) { try view.inspect().find(ViewType.ProgressView.self) }

    let failing = await Fixtures.signedIn(sockets: ScriptedRooms([
      ScriptedRoom([#"{"type":"error","message":"Room is full."}"#])
    ]))
    let failed = GuessModel(guild: Fixtures.guild, app: failing)
    failed.open(room)
    await failed.play()
    try GuessRoomView(model: failed, room: room).inspect().find(button: "Try Again").tap()
    #expect(failed.attempt == 1)
    #expect(throws: Never.self) {
      try GuessRoomView(model: failed, room: room).inspect().find(ViewType.ShareLink.self)
    }
  }

  @Test
  func `a playing match asks before leaving`() async throws {
    let model = try await Self.model()
    let play = Task { await model.play() }
    await Fixtures.wait { model.state?.phase == .lobby }
    let room = try #require(model.room)
    let view = GuessRoomView(model: model, room: room).environment(model.app)
    #expect(throws: Never.self) { try view.inspect().find(GuessPlayView.self) }
    try view.inspect().find(button: "Start Match").tap()
    await Fixtures.wait { model.state?.phase == .round }
    await Hosting.show(NavigationStack { view }, model: model.app) {
      model.guess = "nope"
      try? GuessInputBar(model: model).inspect().find(button: "Send").tap()
      try? GuessInputBar(model: model).inspect().find(ViewType.TextField.self).callOnSubmit()
      await Fixtures.wait { model.wrongGuesses > 0 }
    }
    play.cancel()
    await play.value
  }

  @Test(arguments: [GamePhase.lobby, .loading, .ready, .round, .reveal, .final])
  func `every phase shows its stage and controls`(phase: GamePhase) async throws {
    let model = try await Self.model()
    let view = GuessPlayView(model: model, state: Self.state(phase)).environment(model.app)
    #expect(throws: Never.self) { try view.inspect().find(GuessStageView.self) }
    if phase == .final {
      try view.inspect().find(button: "Play Again").tap()
    }
    let stage = GuessStageView(state: Self.state(phase), image: nil, received: .now)
    #expect(throws: Never.self) { try stage.inspect().find(ViewType.VStack.self) }
  }

  @Test
  func `round images blur over time and reveal the answer`() async throws {
    let frames = [TestImages.frame(red: 1)].compactMap(\.self)
    let image = EmoteImage.animated(frames: frames + frames, delays: [0.1, 0.1])
    let round = GuessStageView(state: Self.state(.round), image: image, received: .now)
    let reveal = GuessStageView(state: Self.state(.reveal), image: image, received: .now)
    let unnamed = Self.state(.reveal, answer: nil)
    let mystery = GuessStageView(state: unnamed, image: image, received: .now)
    let noTimer = GuessStageView(
      state: Self.state(.round, remaining: nil),
      image: image,
      received: .now
    )
    #expect(throws: Never.self) { try round.inspect().find(ViewType.TimelineView.self) }
    let revealed = try reveal.inspect().find(AnimatedEmoteView.self)
    #expect(try revealed.accessibilityLabel().string() == "Emote: cat")
    let anonymous = try mystery.inspect().find(AnimatedEmoteView.self)
    #expect(try anonymous.accessibilityLabel().string() == "Emote")
    #expect(throws: Never.self) { try noTimer.inspect().find(ViewType.ProgressView.self) }
    let app = Fixtures.misconfigured()
    await Hosting.show(VStack { round
      reveal
      mystery
      noTimer
    }, model: app)
  }

  @Test
  func `reconnecting rooms say so and scores stack at large text sizes`() async throws {
    let rooms = ScriptedRooms([ScriptedRoom([])])
    let app = await Fixtures.signedIn(sockets: rooms)
    let model = GuessModel(guild: Fixtures.guild, app: app, firstReconnectDelay: .seconds(5))
    try model.open(#require(GameRoomCode("K7QF2M")))
    let play = Task { await model.play() }
    await Fixtures.wait { model.connection == .reconnecting }
    let view = GuessPlayView(model: model, state: Self.state(.lobby)).environment(app)
    #expect(throws: Never.self) { try view.inspect().find(text: "Reconnecting…") }
    play.cancel()
    await play.value

    let row = GuessScoreRow(name: "You", score: 3, rank: 1, isPlayer: true)
      .environment(\.dynamicTypeSize, .accessibility2)
    await Hosting.show(row, model: app)
  }

  @Test
  func `the lock view hides the emotes`() throws {
    #expect(throws: Never.self) {
      try GuessLockView().inspect().find(ViewType.ContentUnavailableView.self)
    }
  }
}
