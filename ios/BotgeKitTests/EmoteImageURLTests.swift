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
    #expect(EmoteImageURL.candidates(for: path).isEmpty)
  }

  @Test
  func `7TV candidates keep the query`() {
    let urls = EmoteImageURL.candidates(for: "/7tv-cdn/emote/1/2x.webp?quality=high")
    #expect(urls.first?.absoluteString == "https://cdn.7tv.app/emote/1/2x.webp?quality=high")
  }

  @Test
  func `formats are inferred from the last path component`() {
    #expect(ImageFormat(path: "/a/b.JPG") == .jpeg)
    #expect(ImageFormat(path: "/a.b/c") == .unknown)
    #expect(ImageFormat(path: "/a/b.png") == .png)
    #expect(ImageFormat.allCases.filter(\.isAllowed) == [.gif, .jpeg, .png, .webp])
  }

  @Test
  func `sources serialize like the Rust catalog`() throws {
    let data = try JSONEncoder().encode(EmoteSource.allCases)
    #expect(String(bytes: data, encoding: .utf8) == #"["BTTV","FFZ","7TV","Twitch"]"#)
  }

  @Test
  func `paths without a file name have an unknown format`() {
    #expect(ImageFormat(path: "") == .unknown)
    #expect(ImageFormat(path: "/") == .unknown)
  }
}
