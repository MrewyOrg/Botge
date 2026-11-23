@testable import BotgeKit
import Foundation
import Testing

struct EmoteImageURLTests {
  @Test(arguments: [
    ("/7tv-cdn/emote/1/2x.webp?quality=high", "https://cdn.7tv.app/emote/1/2x.webp?quality=high")
  ])
  func `allowlisted prefixes map to their provider CDN`(path: String, expected: String) {
    #expect(EmoteImageURL.url(for: path)?.absoluteString == expected)
  }

  @Test(arguments: [
    "7tv-cdn/emote/1",
    "/evil-cdn/x",
    "/7tv-cdn",
    "/7tv-cdn/../x",
    "/7tv-cdn/a\\b",
    "https://cdn.7tv.app/x"
  ])
  func `other paths are refused`(path: String) {
    #expect(EmoteImageURL.url(for: path) == nil)
    #expect(EmoteImageURL.requestURL(for: path) == nil)
  }

  @Test
  func `load paths pick the 7TV format and keep the query`() {
    let still = EmoteImageURL.loadPath(
      for: "/7tv-cdn/emote/1/2x.webp?quality=high",
      isAnimated: false
    )
    #expect(still == "/7tv-cdn/emote/1/2x.png?quality=high")
    let bare = EmoteImageURL.loadPath(for: "/7tv-cdn/emote/1.0/2x", isAnimated: true)
    #expect(bare == "/7tv-cdn/emote/1.0/2x.gif")
    let url = EmoteImageURL.requestURL(for: still)
    #expect(url?.absoluteString == "https://cdn.7tv.app/emote/1/2x.png?quality=high")
  }

  @Test
  func `sources serialize like the Rust catalog`() throws {
    let data = try JSONEncoder().encode(EmoteSource.allCases)
    #expect(String(bytes: data, encoding: .utf8) == #"["7TV"]"#)
  }
}
