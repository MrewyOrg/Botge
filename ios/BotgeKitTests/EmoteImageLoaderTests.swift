@testable import BotgeKit
import Foundation
import Testing

struct EmoteImageLoaderTests {
  private static let path = "/7tv-cdn/emote/abc/2x"

  @Test
  func `decoded images are served from memory until cleared`() async {
    let png = StubTransport.Reply.response(status: 200, body: ImageFixtures.png())
    let transport = StubTransport([png, png])
    let loader = EmoteImageLoader(transport: transport)
    _ = await loader.image(for: Self.path, animated: false)
    _ = await loader.image(for: Self.path, animated: false)
    #expect(transport.requests.count == 1)

    await loader.clearMemory()
    _ = await loader.image(for: Self.path, animated: false)
    #expect(transport.requests.count == 2)
  }

  @Test
  func `still requests skip animation decoding`() async {
    let gif = StubTransport.Reply.response(
      status: 200,
      body: ImageFixtures.gif(frames: 3, delay: 0.1)
    )
    let image = await EmoteImageLoader(transport: StubTransport([gif])).image(
      for: Self.path,
      animated: false
    )
    guard case .still = image else {
      Issue.record("Expected the first frame only")
      return
    }
  }

  @Test
  func `concurrent requests share one download and are readable synchronously`() async {
    let png = StubTransport.Reply.response(status: 200, body: ImageFixtures.png())
    let transport = StubTransport([png])
    let loader = EmoteImageLoader(transport: transport)
    #expect(loader.cachedImage(for: Self.path, animated: false) == nil)
    async let first = loader.image(for: Self.path, animated: false)
    async let second = loader.image(for: Self.path, animated: false)
    _ = await (first, second)
    #expect(transport.requests.count == 1)
    #expect(loader.cachedImage(for: Self.path, animated: false) != nil)
    #expect(loader.cachedImage(for: Self.path, animated: true) == nil)
  }

  @Test
  func `the cache drops the least recently used images beyond its byte limit`() throws {
    let frame = try #require(ImageFixtures.frame(red: 1))
    let still = EmoteImage.still(frame)
    let cost = EmoteImageCache.cost(of: still)
    #expect(cost == ImageFixtures.size * ImageFixtures.size * 4)
    #expect(EmoteImageCache.cost(of: .placeholder) == 0)
    #expect(EmoteImageCache.cost(of: .animated(frames: [frame, frame], delays: [1, 1])) == cost * 2)

    let cache = EmoteImageCache(costLimit: cost * 2)
    cache.insert(still, forKey: "a")
    #expect(cache.image(forKey: "a") != nil)
    #expect(cache.image(forKey: "missing") == nil)
    cache.insert(.animated(frames: [frame, frame, frame], delays: [1, 1, 1]), forKey: "big")
    #expect(cache.image(forKey: "big") == nil)
    cache.removeAll()
    #expect(cache.image(forKey: "a") == nil)
  }
}
