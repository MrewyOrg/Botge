@testable import Botge
import BotgeKit
import Foundation
import Testing

struct EmotesDiscoveryTests {
  /// A one-emote page of `count` pages.
  private static func page(_ name: String, of count: Int) -> RoutedTransport.Reply {
    let id = "01234567890123456789\(name.count)ABCDE"
    let item = #"{"id":"\#(id)","defaultName":"\#(name)","tags":[],"flags":{"animated":false,"#
      + #""nsfw":false,"private":false,"publicListed":true},"images":[{"url":"#
      + #""https://cdn.7tv.app/emote/\#(id)/2x.webp"}]}"#
    return .json(
      status: 200,
      body: #"{"data":{"emotes":{"search":{"pageCount":\#(count),"items":[\#(item)]}}}}"#
    )
  }

  private static func model(_ routes: [RoutedTransport.Reply]) async -> EmotesModel {
    let transport = RoutedTransport(["gql": routes])
    let model = await EmotesModel(
      guild: Fixtures.guild,
      app: Fixtures.signedIn(transport: transport)
    )
    await model.load()
    return model
  }

  @Test
  func `the server source has no discovery to sync`() async {
    let model = await Self.model([])
    await model.syncDiscovery()
    await model.loadMoreDiscovery()
    #expect(model.discoveries.isEmpty)
  }

  @Test
  func `rankings page, keep loaded results, and save the first page`() async {
    let model = await Self.model([Self.page("one", of: 2), Self.page("three", of: 2)])
    model.source = .discovery(.top)
    await model.syncDiscovery()
    #expect(model.discovery.emotes.map(\.name) == ["one"])
    #expect(model.discovery.hasMore)
    await model.syncDiscovery()
    await model.loadMoreDiscovery()
    #expect(model.discovery.emotes.map(\.name) == ["one", "three"])
    #expect(!model.discovery.hasMore)
    await model.loadMoreDiscovery()
    #expect(model.discovery.page == 2)

    let saved = await model.app.snapshots.read(
      DiscoveryPage.self,
      key: EmotesModel.snapshotKey(.top)
    )
    #expect(saved?.emotes.map(\.name) == ["one"])
    await model.reloadDiscovery(.top)
    #expect(model.discovery.page == 1)
  }

  @Test
  func `a changed search waits for typing to pause and failures are kept`() async {
    let model = await Self.model([Self.page("one", of: 1), .failure(.timedOut)])
    model.source = .discovery(.trending)
    await model.syncDiscovery()
    model.filter.query = "cat"
    await model.syncDiscovery()
    #expect(model.discovery.failure == .network)
    #expect(model.discovery.isCurrent(for: model.filter))
    #expect(model.visibleEmotes.isEmpty)
  }

  @Test
  func `a cancelled load records no failure`() async {
    let model = await Self.model([.delayed(.failure(.cancelled))])
    model.source = .discovery(.top)
    let load = Task { await model.reloadDiscovery(.top) }
    await Fixtures.wait { model.discovery.isLoading }
    load.cancel()
    await load.value
    #expect(model.discovery.failure == nil)
  }

  @Test
  func `a search cancelled while typing does not load`() async {
    let model = await Self.model([Self.page("one", of: 1)])
    model.source = .discovery(.trending)
    await model.syncDiscovery()
    model.filter.query = "cat"
    let task = Task { await model.syncDiscovery() }
    task.cancel()
    await task.value
    #expect(model.discovery.filter.query.isEmpty)
  }

  @Test
  func `results for an outdated search are dropped`() async {
    let model = await Self.model([.delayed(Self.page("one", of: 1))])
    model.source = .discovery(.trending)
    let load = Task { await model.reloadDiscovery(.trending) }
    await Fixtures.wait { model.discovery.isLoading }
    model.discoveries[.trending]?.filter.query = "x"
    await load.value
    #expect(model.discovery.emotes.isEmpty)
  }
}
