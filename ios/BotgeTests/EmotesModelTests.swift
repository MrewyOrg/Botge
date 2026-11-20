@testable import Botge
import BotgeKit
import Foundation
import Testing

struct EmotesModelTests {
  private static let signedOutReply = RoutedTransport.Reply.json(
    status: 401,
    body: #"{"message":"no"}"#
  )

  private static func loaded(_ transport: RoutedTransport = RoutedTransport()) async
    -> EmotesModel
  {
    let model = await EmotesModel(
      guild: Fixtures.guild,
      app: Fixtures.signedIn(transport: transport)
    )
    await model.load()
    return model
  }

  @Test
  func `the catalog loads, is saved, and shows at once next time`() async {
    let app = await Fixtures.signedIn()
    let first = EmotesModel(guild: Fixtures.guild, app: app)
    await first.load()
    #expect(first.catalog?.emotes.count == 2)
    #expect(first.visibleEmotes.map(\.name) == ["peepoHey", "Kappa"])

    let offline = await Fixtures.signedIn(transport: RoutedTransport([
      "catalog": [.failure(.notConnectedToInternet)]
    ]))
    let shared = EmotesModel(guild: Fixtures.guild, app: offline)
    await shared.load()
    #expect(shared.failure == .network)
    #expect(shared.catalog == nil)
  }

  @Test
  func `a rejected login while loading signs out`() async {
    let model = await Self.loaded(RoutedTransport(["catalog": [Self.signedOutReply]]))
    #expect(model.app.phase == .signedOut)
  }

  @Test
  func `a misconfigured build loads and changes nothing`() async {
    let model = EmotesModel(guild: Fixtures.guild, app: Fixtures.misconfigured())
    await model.load()
    await model.watch()
    await model.remove(Fixtures.added)
    await model.add(Fixtures.discovered)
    #expect(model.catalog == nil && model.notice == nil)
  }

  @Test
  func `removing an added emote reports the outcome and reloads`() async {
    let replies: [RoutedTransport.Reply] = [
      .json(status: 200, body: #"{"message":"Removed."}"#),
      .json(status: 403, body: #"{"message":"Not a manager."}"#),
      Self.signedOutReply
    ]
    let transport = RoutedTransport(["emotes/remove": replies])
    let model = await Self.loaded(transport)
    #expect(model.canRemove(Fixtures.added))
    #expect(!model.canRemove(Fixtures.discovered))
    await model.confirm(.single(Fixtures.added))
    #expect(model.notice == "Removed.")
    #expect(model.haptic?.kind == .success)
    await model.remove(Fixtures.added)
    #expect(model.notice == "Not a manager.")
    #expect(model.haptic?.kind == .failure)
    await model.remove(Fixtures.added)
    #expect(model.app.phase == .signedOut)
  }

  @Test
  func `adding a discovered emote reports the outcome`() async {
    let replies: [RoutedTransport.Reply] = [
      .json(status: 200, body: #"{"message":"Added."}"#),
      .failure(.timedOut),
      Self.signedOutReply
    ]
    let transport = RoutedTransport(["/emotes": replies])
    let model = await Self.loaded(transport)
    #expect(model.canAdd(Fixtures.discovered))
    #expect(!model.canAdd(Fixtures.added))
    await model.add(Fixtures.discovered)
    #expect(model.notice == "Added.")
    await model.add(Fixtures.discovered)
    #expect(model.haptic?.kind == .failure)
    await model.add(Fixtures.discovered)
    #expect(model.app.phase == .signedOut)
  }

  @Test
  func `composing adds emotes until the composition is full`() async {
    let model = await Self.loaded()
    #expect(model.compose(Fixtures.added))
    #expect(model.haptic?.kind == .impact)
    #expect(!model.compose(Fixtures.discovered))
    #expect(model.haptic?.kind == .failure)
    #expect(model.notice?.contains("catJAM") == true)
  }

  @Test
  func `scroll anchors and filters are kept per source`() async {
    let model = await Self.loaded()
    model.setScrollAnchor("a", for: .server)
    model.setScrollAnchor(nil, for: .server)
    #expect(model.scrollAnchor(for: .server) == "a")
    #expect(model.scrollAnchor(for: .discovery(.top)) == nil)
    model.filter.query = "pee"
    #expect(model.visibleEmotes.map(\.name) == ["peepoHey"])
    model.source = .discovery(.top)
    #expect(model.filter.query.isEmpty)
    #expect(model.discovery.page == 0)
  }

  @Test
  func `the watch signs out when the login is rejected`() async {
    let model = await Self.loaded(RoutedTransport(["catalog/watch": [Self.signedOutReply]]))
    await model.watch()
    #expect(model.app.phase == .signedOut)
  }

  @Test
  func `refreshing reloads the current source`() async {
    let transport = RoutedTransport()
    let model = await Self.loaded(transport)
    await model.refresh()
    model.source = .discovery(.trending)
    await model.refresh()
    #expect(model.discovery.emotes.count == 60)
    #expect(transport.requests.count { $0.url?.lastPathComponent == "catalog" } == 2)
  }

  @Test
  func `catalog changes reload and discovery shows before the catalog loads`() async {
    let rooms = ScriptedRooms([ScriptedRoom([#"{"type":"watching"}"#, #"{"type":"changed"}"#])])
    let transport = RoutedTransport()
    let app = await Fixtures.signedIn(transport: transport, sockets: rooms)
    let model = EmotesModel(guild: Fixtures.guild, app: app)
    model.source = .discovery(.top)
    model.discoveries[.top] = DiscoveryState(emotes: [Fixtures.discovered])
    #expect(model.visibleEmotes == [Fixtures.discovered])
    let watch = Task { await model.watch() }
    await Fixtures.wait { model.catalog != nil }
    watch.cancel()
    await watch.value
    #expect(model.catalog != nil)
  }

  @Test
  func `a burst of change notices costs at most two catalog requests`() async {
    let changes = Array(repeating: #"{"type":"changed"}"#, count: 6)
    let rooms = ScriptedRooms([ScriptedRoom([#"{"type":"watching"}"#] + changes)])
    let catalog = RoutedTransport.Reply.delayed(.json(
      status: 200,
      body: #"{"emotes":[],"canManageEmotes":false,"canComposeDiscovery":false}"#
    ))
    let transport = RoutedTransport(["catalog": [catalog]])
    let app = await Fixtures.signedIn(transport: transport, sockets: rooms)
    let model = EmotesModel(guild: Fixtures.guild, app: app)
    let watch = Task { await model.watch() }
    await Fixtures.wait { model.catalog != nil }
    try? await Task.sleep(for: .milliseconds(800))
    watch.cancel()
    await watch.value
    #expect(transport.requests.count { $0.url?.lastPathComponent == "catalog" } == 2)
  }
}
