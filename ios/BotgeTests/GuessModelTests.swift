@testable import Botge
import BotgeKit
import Foundation
import Testing

struct GuessModelTests {
  private static let room: GameRoomCode? = .init("K7QF2M")

  private static func state(_ phase: String, round: Int = 1, extra: String = "") -> String {
    #"{"type":"state","state":{"phase":"\#(phase)","round":\#(round),"rounds":1,"#
      + #""roundMs":20000,"players":[],"guesses":[]\#(extra)}}"#
  }

  private static func model(
    transport: RoutedTransport = RoutedTransport(),
    sockets: any SocketConnecting = FixtureSockets()
  )
    async throws -> GuessModel
  {
    let app = await Fixtures.signedIn(transport: transport, sockets: sockets)
    let model = GuessModel(guild: Fixtures.guild, app: app, firstReconnectDelay: .milliseconds(1))
    try model.open(#require(Self.room))
    return model
  }

  @Test
  func `a match plays from the lobby to the final result`() async throws {
    let model = try await Self.model()
    #expect(model.haptic?.kind == .selection)
    let play = Task { await model.play() }
    await Fixtures.wait { model.state?.phase == .lobby }
    #expect(model.connection == .connected)
    #expect(model.player == FixtureGameSocket.player)
    await model.start()
    await Fixtures.wait { model.state?.phase == .round }
    #expect(model.isGuessing)
    #expect(model.app.isPlayingGuess)
    model.guess = "much too long"
    #expect(model.guess == "much t")
    model.guess = "  "
    await model.submitGuess()
    model.guess = "nope"
    await model.submitGuess()
    await Fixtures.wait { model.wrongGuesses == 1 }
    #expect(model.haptic?.kind == .failure)
    model.guess = "catJAM"
    await model.submitGuess()
    await Fixtures.wait { model.state?.phase == .reveal }
    #expect(model.haptic?.kind == .success)
    await Fixtures.wait { model.state?.phase == .final }
    #expect(model.taskID.hasSuffix("|0"))
    model.leave()
    play.cancel()
    await play.value
    #expect(model.state == nil && model.room == nil && !model.app.isPlayingGuess)
  }

  @Test
  func `room errors fail the connection until the player retries`() async throws {
    let rooms = ScriptedRooms([ScriptedRoom([#"{"type":"error","message":"Room is full."}"#])])
    let model = try await Self.model(sockets: rooms)
    await model.play()
    #expect(model.connection == .failed("Room is full."))
    model.resume()
    #expect(model.connection == .joining)
    #expect(model.attempt == 1)
  }

  @Test
  func `dropped connections reconnect a few times, then give up`() async throws {
    let transport = RoutedTransport(["game/join": [.failure(.timedOut)]])
    let model = try await Self.model(transport: transport)
    await model.play()
    #expect(model.connection == .failed(APIError.network.message))
    #expect(transport.requests.count { $0.url?.lastPathComponent == "join" } == 4)
  }

  @Test
  func `a rejected login ends the game and signs out`() async throws {
    let transport = RoutedTransport(["game/join": [.json(status: 401, body: #"{"message":"no"}"#)]])
    let model = try await Self.model(transport: transport)
    await model.play()
    #expect(model.app.phase == .signedOut)
  }

  @Test
  func `winning rounds and new rounds play haptics and clear the guess`() async throws {
    let player = FixtureGameSocket.player
    let won = #","players":[{"id":"\#(player)","score":3}]"#
    let messages = [
      Self.state("round", extra: #","hint":"abc""#),
      Self.state("round", round: 2, extra: #","hint":"abc""#),
      Self.state("final", round: 2).replacing(#","players":[]"#, with: won)
    ]
    let rooms = ScriptedRooms([ScriptedRoom(messages)])
    let model = try await Self.model(sockets: rooms)
    let play = Task { await model.play() }
    await Fixtures.wait { model.state?.phase == .final }
    #expect(model.haptic?.kind == .success)
    play.cancel()
    await play.value
  }

  @Test
  func `nothing plays without a room or a configured build`() async {
    let app = Fixtures.misconfigured()
    let model = GuessModel(guild: Fixtures.guild, app: app)
    await model.play()
    model.resume()
    #expect(model.connection == .joining)
    #expect(model.attempt == 0)
    #expect(!model.isGuessing)
  }
}
