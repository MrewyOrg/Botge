@testable import BotgeKit
import Foundation
import Testing

struct CatalogTests {
  private static var entries: [[String: Any]] {
    [
      [
        "name": "peepoHey", "source": "7TV", "image": "/7tv-cdn/emote/A/2x.webp",
        "preview": "/7tv-cdn/emote/A/4x.webp", "animated": true, "overlaying": false,
        "tags": ["wave", "hi"], "added": true, "composeToken": "peepoHey", "sevenTVId": "A"
      ],
      [
        "name": "Kappa", "source": "Twitch",
        "image": "/twitch-cdn/emoticons/v2/25/default/dark/2.0",
        "animated": false, "overlaying": false, "tags": [String](), "added": false,
        "composeToken": "Kappa"
      ],
      [
        "name": "RainTime",
        "source": "BTTV",
        "image": "/bttv-cdn/emote/B/2x",
        "animated": true,
        "overlaying": true
      ]
    ]
  }

  private static func catalog() throws -> Catalog {
    let body: [String: Any] = [
      "message": "Server emotes loaded.",
      "canManageEmotes": true,
      "canComposeDiscovery": false,
      "emotes": entries
    ]
    return try JSONDecoder().decode(
      Catalog.self,
      from: JSONSerialization.data(withJSONObject: body)
    )
  }

  @Test
  func `catalog entries decode with defaults for absent fields`() throws {
    let catalog = try Self.catalog()
    #expect(catalog.canManageEmotes)
    #expect(!catalog.canComposeDiscovery)
    let first = try #require(catalog.emotes.first)
    #expect(first.sevenTVID == "A")
    #expect(first.preview == "/7tv-cdn/emote/A/4x.webp")
    #expect(first.isAdded && first.isAnimated && !first.isOverlay)
    let last = try #require(catalog.emotes.last)
    #expect(last.tags.isEmpty && !last.isAdded && last.composeToken == nil && last.isOverlay)
    #expect(Set(catalog.emotes.map(\.id)).count == 3)
  }

  @Test
  func `filter tags list source, motion, overlay, added and provider tags once`() throws {
    let first = try #require(Self.catalog().emotes.first)
    #expect(first.filterTags == ["7TV", "Animated", "Regular", "Added", "wave", "hi"])
    let tagged = CatalogEmote(
      name: "x",
      source: .betterTTV,
      image: "/bttv-cdn/x",
      isAnimated: false,
      tags: ["BTTV", "Static"]
    )
    #expect(tagged.filterTags == ["BTTV", "Static", "Regular"])
  }

  @Test
  func `filters match the Activity's search rules`() throws {
    let emotes = try Self.catalog().emotes
    var filter = EmoteFilter()
    #expect(filter.matchingEmotes(in: emotes).count == 3)
    #expect(filter.activeCount == 0)

    filter.query = "  PEEPO "
    #expect(filter.matchingEmotes(in: emotes).map(\.name) == ["peepoHey"])
    filter.query = ""

    filter.source = .twitch
    #expect(filter.matchingEmotes(in: emotes).map(\.name) == ["Kappa"])
    filter.source = nil

    filter.motion = .still
    #expect(filter.matchingEmotes(in: emotes).map(\.name) == ["Kappa"])
    filter.motion = .animated
    filter.overlay = .overlaying
    #expect(filter.matchingEmotes(in: emotes).map(\.name) == ["RainTime"])
    filter.overlay = .regular
    filter.showsOnlyAdded = true
    #expect(filter.matchingEmotes(in: emotes).map(\.name) == ["peepoHey"])
    #expect(filter.activeCount == 3)

    filter = EmoteFilter()
    filter.tags = "WAV, hi ,,"
    #expect(filter.matchingEmotes(in: emotes).map(\.name) == ["peepoHey"])
    filter.tags = "added, missing"
    #expect(filter.matchingEmotes(in: emotes).isEmpty)
    filter.tags = (1 ... 20).map { "t\($0)" }.joined(separator: ",")
    #expect(filter.tagTerms.count == EmoteFilter.maxTagTerms)
  }

  @Test
  func `compositions group overlays, cap layers and build the command text`() {
    let base = CatalogEmote(
      name: "base",
      source: .sevenTV,
      image: "/7tv-cdn/a",
      isAnimated: false,
      composeToken: "base"
    )
    let overlay = CatalogEmote(
      name: "rain",
      source: .sevenTV,
      image: "/7tv-cdn/b",
      isAnimated: true,
      isOverlay: true,
      composeToken: "rain"
    )
    let blocked = CatalogEmote(
      name: "x",
      source: .sevenTV,
      image: "/7tv-cdn/c",
      isAnimated: false,
      composeToken: "x"
    )
    let unnamed = CatalogEmote(
      name: "y y",
      source: .sevenTV,
      image: "/7tv-cdn/d",
      isAnimated: false
    )
    var composition = Composition()
    let accepted = [
      composition.add(overlay),
      composition.add(base),
      composition.add(overlay),
      composition.add(blocked),
      composition.add(unnamed)
    ]
    #expect(accepted == [true, true, true, false, false])
    #expect(composition.commandText == "rain base rain")
    #expect(composition.columns.map { $0.map(\.name) } == [["rain"], ["base", "rain"]])
  }

  @Test
  func `compositions reorder, remove, cap and clear layers`() {
    let base = CatalogEmote(
      name: "base",
      source: .sevenTV,
      image: "/7tv-cdn/a",
      isAnimated: false,
      composeToken: "base"
    )
    let overlay = CatalogEmote(
      name: "rain",
      source: .sevenTV,
      image: "/7tv-cdn/b",
      isAnimated: true,
      isOverlay: true,
      composeToken: "rain"
    )
    var composition = Composition()
    composition.add(overlay)
    composition.add(base)
    composition.add(overlay)
    composition.move(fromOffsets: [0], toOffset: 3)
    #expect(composition.commandText == "base rain rain")
    composition.move(fromOffsets: [2], toOffset: 0)
    #expect(composition.commandText == "rain base rain")
    composition.move(fromOffsets: [9], toOffset: 0)
    composition.move(fromOffsets: [0], toOffset: 9)
    #expect(composition.commandText == "rain base rain")
    composition.remove(at: 0)
    composition.remove(at: 7)
    #expect(composition.commandText == "base rain")

    for _ in 0 ..< Composition.maxLayers {
      composition.add(base)
    }
    #expect(composition.isFull && composition.layers.count == Composition.maxLayers)
    composition.clear()
    #expect(composition.layers.isEmpty && composition.commandText.isEmpty)
    #expect(!Composition.isComposeToken("a") && Composition.isComposeToken("ab"))
  }
}
