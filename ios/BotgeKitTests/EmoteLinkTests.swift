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
  }

  @Test
  func `emotes without a page share their image`() {
    let invalidID = Self.emote(.sevenTV, "/7tv-cdn/emote/A/2x.webp", id: "nope")
    #expect(EmoteLink.url(for: invalidID)?.host() == "cdn.7tv.app")
    #expect(EmoteLink.url(for: Self.emote(.sevenTV, "/elsewhere/x")) == nil)
  }

  @Test
  func `bundles without a URL scheme have none`() {
    #expect(AppLink.scheme(in: Bundle(for: ScriptedConnector.self)).isEmpty)
  }
}
