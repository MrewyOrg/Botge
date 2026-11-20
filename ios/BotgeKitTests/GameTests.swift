@testable import BotgeKit
import Foundation
import Testing

struct GameTests {
  private static let roundJSON = #"""
  {"type":"state","state":{"phase":"round","round":2,"rounds":10,"roundMs":20000,
  "remainingMs":5000,"image":"tok_1","hint":"c_t_A_","players":[{"id":"1","score":7},
  {"id":"2","score":7},{"id":"3","score":2}],"guesses":[{"id":"2","text":"cat"}]}}
  """#

  private static func decode(_ json: String) throws -> GameMessage {
    try JSONDecoder().decode(GameMessage.self, from: Data(json.utf8))
  }

  private static func state(_ message: GameMessage) throws -> GameState {
    guard case let .state(state) = message else {
      Issue.record("Expected a state message")
      throw CancellationError()
    }

    return state
  }

  @Test
  func `room messages decode like the Activity's parser`() throws {
    let state = try Self.state(Self.decode(Self.roundJSON))
    #expect(state.phase == .round)
    #expect(state.hint == "c_t_A_")
    #expect(state.remaining == 5)
    #expect(state.roundLength == 20)
    #expect(state.guesses == [GameGuess(id: "2", text: "cat")])
    #expect(try Self.decode(#"{"type":"wrong"}"#) == .wrong)
    #expect(try Self.decode(#"{"type":"error","message":"No."}"#) == .error("No."))

    let lobby = try Self.state(Self.decode(
      #"{"type":"state","state":{"phase":"lobby","round":0,"rounds":0,"roundMs":0,"players":[]}}"#
    ))
    #expect(lobby.guesses.isEmpty)
    #expect(lobby.remaining == nil)
    for bad in [
      #"{"type":"party"}"#,
      #"{"type":"error"}"#,
      #"{"type":"state","state":{"phase":"nap","round":0,"rounds":0,"roundMs":0,"players":[]}}"#,
      #"{"type":"state","state":{"phase":"lobby","round":-1,"rounds":0,"roundMs":0,"players":[]}}"#
    ] {
      #expect(throws: DecodingError.self) { try Self.decode(bad) }
    }
  }

  @Test
  func `ranks share places and final results name the winner or a tie`() throws {
    let state = try Self.state(Self.decode(Self.roundJSON))
    #expect(state.rank(of: "1") == 1)
    #expect(state.rank(of: "2") == 1)
    #expect(state.rank(of: "3") == 3)
    #expect(state.rank(of: "9") == nil)
    #expect(state.result == nil)

    let win = GameState(
      phase: .final,
      players: [GameScore(id: "1", score: 3), GameScore(id: "2", score: 1)]
    )
    #expect(win.result == .won(player: "1"))
    let tie = GameState(
      phase: .final,
      players: [GameScore(id: "1", score: 3), GameScore(id: "2", score: 3)]
    )
    #expect(tie.result == .tie)
    #expect(GameState(phase: .final, players: [GameScore(id: "1", score: 0)])
      .result == .nobodyScored)
    #expect(GameState(phase: .final).result == .nobodyScored)
    #expect(GamePhase.round.isPlaying)
    #expect(!GamePhase.final.isPlaying)
  }

  @Test
  func `the blur eases from the start radius to the end radius`() {
    #expect(GameState.blur(remaining: 20, length: 20) == GameState.startBlur)
    #expect(GameState.blur(remaining: 0, length: 20) == GameState.endBlur)
    #expect(GameState.blur(remaining: 10, length: 20) == 15.5)
    #expect(GameState.blur(remaining: 40, length: 20) == GameState.startBlur)
    #expect(GameState.blur(remaining: 5, length: 0) == GameState.endBlur)
  }

  @Test
  func `room codes are generated from a clear alphabet and parsed leniently`() {
    var generator = SystemRandomNumberGenerator()
    let room = GameRoomCode.random(using: &generator)
    #expect(room.code.count == GameRoomCode.length)
    #expect(room.code.allSatisfy(GameRoomCode.alphabet.contains))
    #expect(room.instanceID == "app-\(room.code)")
    #expect(GameRoomCode.random().code.count == GameRoomCode.length)
    #expect(GameRoomCode(" app-k7qf2m ")?.code == "K7QF2M")
    #expect(GameRoomCode("APP-AB12")?.instanceID == "app-AB12")
    for bad in ["", "app-", "has space", "café", String(repeating: "A", count: 33)] {
      #expect(GameRoomCode(bad) == nil)
    }
  }

  @Test
  func `live activity content follows the round and the local player`() throws {
    let received = Date(timeIntervalSince1970: 1_000)
    let round = try Self.state(Self.decode(Self.roundJSON))
    let content = try #require(
      GuessActivityAttributes.ContentState(state: round, player: "3", received: received)
    )
    #expect(content.round == 2)
    #expect(content.roundEndsAt == received.addingTimeInterval(5))
    #expect(content.score == 2)
    #expect(content.rank == 3)

    let ready = GameState(
      phase: .ready,
      round: 1,
      roundMilliseconds: 20_000,
      remainingMilliseconds: 3_000
    )
    let early = try #require(
      GuessActivityAttributes.ContentState(state: ready, player: "9", received: received)
    )
    #expect(early.roundEndsAt == received.addingTimeInterval(23))
    #expect(early.score == 0)
    #expect(early.rank == 1)
    let reveal = GameState(phase: .reveal, round: 3)
    #expect(GuessActivityAttributes.ContentState(state: reveal, player: "1", received: received)?
      .roundEndsAt == received)
    for phase in [GamePhase.lobby, .loading, .final] {
      #expect(GuessActivityAttributes.ContentState(
        state: GameState(phase: phase),
        player: "1",
        received: received
      ) == nil)
    }
  }

  @Test
  func `live activity content tolerates missing timing`() throws {
    let received = Date(timeIntervalSince1970: 1_000)
    let ready = GameState(phase: .ready, round: 0, roundMilliseconds: 20_000)
    let early = try #require(
      GuessActivityAttributes.ContentState(state: ready, player: "1", received: received)
    )
    #expect(early.roundEndsAt == received.addingTimeInterval(20))
    #expect(early.round == 1)
    let noTimer = GameState(phase: .round, round: 2)
    #expect(GuessActivityAttributes.ContentState(state: noTimer, player: "1", received: received)?
      .roundEndsAt == received)
  }
}
