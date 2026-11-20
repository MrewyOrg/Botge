@testable import BotgeKit
import Foundation
import Testing

struct EmoteImageURLTests {
  @Test(arguments: [
    ("/7tv-cdn/emote/1/2x.webp?quality=high", "https://cdn.7tv.app/emote/1/2x.webp?quality=high"),
    ("/bttv-cdn/emote/abc/2x", "https://cdn.betterttv.net/emote/abc/2x"),
    ("/ffz-cdn/emote/1/2", "https://cdn.frankerfacez.com/emote/1/2"),
    (
      "/twitch-cdn/emoticons/v2/1/default/dark/2.0",
      "https://static-cdn.jtvnw.net/emoticons/v2/1/default/dark/2.0"
    )
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
    let twitch = "/twitch-cdn/emoticons/v2/1/default/dark/2.0"
    #expect(EmoteImageURL.loadPath(for: twitch, isAnimated: true) == twitch)
    let url = EmoteImageURL.requestURL(for: still)
    #expect(url?.absoluteString == "https://cdn.7tv.app/emote/1/2x.png?quality=high")
    #expect(EmoteImageURL.requestURL(for: "/ffz-cdn/emote/1/2.png")?.lastPathComponent == "2.png")
  }

  @Test
  func `sources serialize like the Rust catalog`() throws {
    let data = try JSONEncoder().encode(EmoteSource.allCases)
    #expect(String(bytes: data, encoding: .utf8) == #"["BTTV","FFZ","7TV","Twitch"]"#)
  }
}
