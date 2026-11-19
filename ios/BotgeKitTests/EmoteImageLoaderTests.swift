@testable import BotgeKit
import Foundation
import Testing

struct EmoteImageLoaderTests {
  private static let path = "/bttv-cdn/emote/abc/2x"

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
  func `memory keeps only the newest images`() async {
    let replies = Array(
      repeating: StubTransport.Reply.response(status: 200, body: ImageFixtures.png()),
      count: EmoteImageLoader.memoryLimit + 2
    )
    let transport = StubTransport(replies)
    let loader = EmoteImageLoader(transport: transport)
    for index in 0 ... EmoteImageLoader.memoryLimit {
      _ = await loader.image(for: "\(Self.path)/\(index)", animated: false)
    }
    _ = await loader.image(for: "\(Self.path)/0", animated: false)
    #expect(transport.requests.count == EmoteImageLoader.memoryLimit + 2)
  }
}
