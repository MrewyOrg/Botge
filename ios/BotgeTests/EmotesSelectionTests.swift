@testable import Botge
import BotgeKit
import Foundation
import Testing

struct EmotesSelectionTests {
  private static func model(_ transport: RoutedTransport = RoutedTransport()) async
    -> EmotesModel
  {
    let model = await EmotesModel(
      guild: Fixtures.guild,
      app: Fixtures.signedIn(transport: transport)
    )
    await model.load()
    model.isSelecting = true
    return model
  }

  private static func batch(_ results: [(String, Bool)]) -> RoutedTransport.Reply {
    let items = results.map { #"{"emoteId":"\#($0.0)","ok":\#($0.1),"message":"m\#($0.0)"}"# }
    return .json(status: 200, body: "[" + items.joined(separator: ",") + "]")
  }

  @Test
  func `server emotes select for removal and explain refusals`() async {
    let model = await Self.model()
    let kappa = model.visibleEmotes[1]
    #expect(model.batchAction == .remove)
    model.toggleSelection(kappa)
    #expect(model.selection.isEmpty)
    #expect(model.notice?.isEmpty == false)
    model.toggleSelection(Fixtures.added)
    #expect(model.selection == [Fixtures.added.id])
    model.toggleSelection(Fixtures.added)
    #expect(model.selection.isEmpty)
    #expect(model.haptic?.kind == .selection)
  }

  @Test
  func `discovery selects emotes to add, up to the batch limit`() async {
    let model = await Self.model()
    model.source = .discovery(.top)
    #expect(model.batchAction == .add)
    model.toggleSelection(Fixtures.added)
    #expect(model.selection.isEmpty)
    let many = (0 ... BotgeAPI.maxBatch).map { index in
      CatalogEmote(
        name: "e\(index)",
        source: .sevenTV,
        image: "/7tv-cdn/emote/\(index)/2x.webp",
        isAnimated: false,
        sevenTVID: "\(index)"
      )
    }
    many.forEach(model.toggleSelection)
    #expect(model.selection.count == BotgeAPI.maxBatch)
    #expect(model.haptic?.kind == .failure)
    model.endSelection()
    #expect(!model.isSelecting && model.selection.isEmpty)
  }

  @Test
  func `removing a selection asks first, then reports each result`() async {
    let replies: [RoutedTransport.Reply] = [
      Self.batch([("A", true)]),
      Self.batch([("A", false)]),
      .failure(.timedOut),
      .json(status: 401, body: #"{"message":"no"}"#)
    ]
    let transport = RoutedTransport(["emotes/batch": replies])
    let model = await Self.model(transport)
    await model.applyBatch()
    #expect(transport.requests.allSatisfy { $0.url?.lastPathComponent != "batch" })
    model.toggleSelection(Fixtures.added)
    await model.requestBatch()
    #expect(model.pendingRemoval?.id == "selection|1")
    await model.confirm(.selection(count: 1))
    #expect(model.haptic?.kind == .success)
    #expect(!model.isSelecting)

    for kind in [HapticEvent.Kind.warning, .failure] {
      model.isSelecting = true
      model.toggleSelection(Fixtures.added)
      await model.applyBatch()
      #expect(model.haptic?.kind == kind)
    }
    #expect(model.notice == APIError.network.message)
    await model.applyBatch()
    #expect(model.app.phase == .signedOut)
  }

  @Test
  func `adding a discovered selection applies at once`() async {
    let transport = RoutedTransport(["emotes/batch": [Self.batch([("0", true)])]])
    let model = await Self.model(transport)
    model.source = .discovery(.trending)
    await model.syncDiscovery()
    let first = model.visibleEmotes[0]
    model.toggleSelection(first)
    await model.requestBatch()
    #expect(model.pendingRemoval == nil)
    #expect(model.selection.isEmpty)
    #expect(model.notice?.contains("1") == true)
  }
}
