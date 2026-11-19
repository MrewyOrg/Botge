@testable import BotgeKit
import Foundation
import Testing

struct ImageLoadingTests {
  private static func ok(_ data: Data) -> StubTransport.Reply {
    .response(status: 200, body: data)
  }

  private static func path(_ id: String) -> String {
    "/7tv-cdn/emote/\(id)/2x.webp"
  }

  @Test
  func `formats are skipped after repeated refusals until one decodes`() {
    let health = FormatHealth()
    for _ in 1 ..< FormatHealth.limit {
      health.record(.webp, decoded: false)
    }
    #expect(!health.isSkipped(.webp))
    health.record(.webp, decoded: false)
    #expect(health.isSkipped(.webp))
    #expect(!health.isSkipped(.gif))

    let proven = FormatHealth()
    proven.record(.gif, decoded: true)
    for _ in 0 ... FormatHealth.limit {
      proven.record(.gif, decoded: false)
    }
    #expect(!proven.isSkipped(.gif))
  }

  @Test
  func `a format the device refuses stops being downloaded`() async {
    let gif = ImageFixtures.gif(frames: 1, delay: 0.1)
    var replies = [StubTransport.Reply]()
    for _ in 0 ..< FormatHealth.limit {
      replies += [Self.ok(Data("refused".utf8)), Self.ok(gif)]
    }
    replies.append(Self.ok(gif))
    let transport = StubTransport(replies)
    let loader = EmoteImageLoader(transport: transport)
    for index in 0 ... FormatHealth.limit {
      _ = await loader.image(for: Self.path("ID\(index)"), animated: false)
    }
    let formats = transport.requests.map { $0.url?.pathExtension ?? "" }
    #expect(formats.suffix(1) == ["gif"])
    #expect(formats.count == FormatHealth.limit * 2 + 1)
    #expect(transport.requests.allSatisfy { $0.cachePolicy == .returnCacheDataElseLoad })
  }

  @Test
  func `a load nobody waits for is cancelled and the next request starts afresh`() async {
    let transport = HangingTransport()
    let loader = EmoteImageLoader(transport: transport)
    let waiter = Task { await loader.image(for: Self.path("A"), animated: false) }
    await transport.wait { $0.requests == 1 }
    waiter.cancel()
    let image = await waiter.value
    guard case .placeholder = image else {
      Issue.record("A cancelled load shows the placeholder")
      return
    }

    await transport.wait { $0.cancelled == 1 }
    #expect(transport.cancelled == 1)

    let again = Task { await loader.image(for: Self.path("A"), animated: false) }
    await transport.wait { $0.requests == 2 }
    #expect(transport.requests == 2)
    again.cancel()
    _ = await again.value
  }

  @Test
  func `snapshots round trip, ignore bad keys and can be cleared`() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let cache = SnapshotCache(directory: directory)
    let json = #"{"name":"peepoHey","source":"7TV","image":"/7tv-cdn/emote/A/2x.webp","#
      + #""animated":true,"added":true,"sevenTVId":"A","tags":["wave"]}"#
    let emote = try JSONDecoder().decode(CatalogEmote.self, from: Data(json.utf8))
    let catalog = Catalog(emotes: [emote], canManageEmotes: true, canComposeDiscovery: false)

    #expect(await cache.read(Catalog.self, key: "catalog-1") == nil)
    await cache.write(catalog, key: "catalog-1")
    #expect(await cache.read(Catalog.self, key: "catalog-1") == catalog)
    let page = DiscoveryPage(emotes: [emote], pageCount: 3)
    await cache.write(page, key: "discovery-top")
    #expect(await cache.read(DiscoveryPage.self, key: "discovery-top") == page)
    #expect(await cache.read(DiscoveryPage.self, key: "catalog-1") == nil)

    for bad in ["", "../x", "a/b", "a b"] {
      await cache.write(catalog, key: bad)
      #expect(await cache.read(Catalog.self, key: bad) == nil)
    }
    #expect(SnapshotCache.standard().directory.lastPathComponent == "Snapshots")

    await cache.removeAll()
    #expect(await cache.read(Catalog.self, key: "catalog-1") == nil)
  }
}
