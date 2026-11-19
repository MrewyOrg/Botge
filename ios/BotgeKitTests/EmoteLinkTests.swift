@testable import BotgeKit
import Foundation
import Testing

struct EmoteLinkTests {
  private static func emote(
    _ source: EmoteSource,
    _ image: String,
    id: String? = nil
  )
    -> CatalogEmote
  {
    CatalogEmote(name: "x", source: source, image: image, isAnimated: false, sevenTVID: id)
  }

  @Test
  func `shared links open the provider's emote page`() {
    let sevenTV = Self.emote(.sevenTV, "/7tv-cdn/emote/A/2x.webp", id: "60ae958e229664e8667aea38")
    #expect(EmoteLink.url(for: sevenTV)?
      .absoluteString == "https://7tv.app/emotes/60ae958e229664e8667aea38")
    let bttv = Self.emote(.betterTTV, "/bttv-cdn/emote/5f1b0186cf6d2144653d2970/2x.webp")
    #expect(EmoteLink.url(for: bttv)?
      .absoluteString == "https://betterttv.com/emotes/5f1b0186cf6d2144653d2970")
    let ffz = Self.emote(.frankerFaceZ, "/ffz-cdn/emote/12/2")
    #expect(EmoteLink.url(for: ffz)?.absoluteString == "https://www.frankerfacez.com/emoticon/12")
  }

  @Test
  func `emotes without a page share their image`() {
    let twitch = Self.emote(.twitch, "/twitch-cdn/emoticons/v2/25/default/dark/2.0")
    #expect(EmoteLink.url(for: twitch)?.host() == "static-cdn.jtvnw.net")
    let invalidID = Self.emote(.sevenTV, "/7tv-cdn/emote/A/2x.webp", id: "nope")
    #expect(EmoteLink.url(for: invalidID)?.host() == "cdn.7tv.app")
    let oddID = Self.emote(.betterTTV, "/bttv-cdn/emote/a%20b/2x.webp")
    #expect(EmoteLink.url(for: oddID)?.host() == "cdn.betterttv.net")
    #expect(EmoteLink.url(for: Self.emote(.betterTTV, "/elsewhere/x")) == nil)
  }
}
