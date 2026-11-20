@testable import BotgeKit
import Foundation
import Testing

struct DiscoveryTests {
  private static let id = "01234567890123456789012345"

  private static func item(
    id: String = Self.id,
    name: String = "peepoHey",
    flags: [String: Any] = [:],
    images: [String] = ["2x.webp", "4x.webp"],
    tags: [Any] = ["wave", " wave ", "", 3, "hi"]
  )
    -> [String: Any]
  {
    var allFlags: [String: Any] = [
      "animated": true,
      "nsfw": false,
      "private": false,
      "publicListed": true,
      "defaultZeroWidth": false
    ]
    allFlags.merge(flags) { _, new in new }
    return [
      "id": id,
      "defaultName": name,
      "tags": tags,
      "flags": allFlags,
      "images": images.map { ["url": "https://cdn.7tv.app/emote/\(id)/\($0)"] }
    ]
  }

  private static func page(_ items: [Any], pageCount: Int = 3) throws -> Data {
    try JSONSerialization.data(withJSONObject: [
      "data": ["emotes": ["search": ["pageCount": pageCount, "items": items]]]
    ])
  }

  @Test
  func `safe entries become 7TV catalog entries`() throws {
    let page = try DiscoveryParser.page(from: Self.page([Self.item()]))
    #expect(page.pageCount == 3)
    let emote = try #require(page.emotes.first)
    #expect(emote.name == "peepoHey" && emote.source == .sevenTV && emote.isAnimated)
    #expect(emote.image == "/7tv-cdn/emote/\(Self.id)/2x.webp")
    #expect(emote.preview == "/7tv-cdn/emote/\(Self.id)/4x.webp")
    #expect(emote.tags == ["wave", "hi"])
    #expect(emote.sevenTVID == Self.id && !emote.isAdded && emote.composeToken == nil)
  }

  @Test
  func `unsafe or malformed entries are dropped`() throws {
    let rejected: [Any] = [
      "not an object",
      Self.item(id: "nope"),
      Self.item(name: "  "),
      Self.item(name: String(repeating: "a", count: 81)),
      Self.item(name: "bad\u{7}name"),
      Self.item(flags: ["nsfw": true]),
      Self.item(flags: ["private": true]),
      Self.item(flags: ["publicListed": false]),
      Self.item(flags: ["animated": "yes"]),
      Self.item(flags: ["nsfw": NSNull()]),
      Self.item(images: ["9x.webp"]),
      ["id": Self.id]
    ]
    let page = try DiscoveryParser.page(from: Self.page(rejected + [Self.item(images: ["1x.gif"])]))
    #expect(page.emotes.map(\.image) == ["/7tv-cdn/emote/\(Self.id)/1x.gif"])
    #expect(page.emotes.first?.preview == nil)
  }

  @Test
  func `invalid pages and GraphQL errors are rejected`() throws {
    let invalid = try [
      Data("nope".utf8),
      JSONSerialization.data(withJSONObject: ["errors": [["message": "x"]]]),
      Self.page([], pageCount: -1),
      JSONSerialization.data(withJSONObject: ["data": ["emotes": [:]]]),
      JSONSerialization.data(withJSONObject: [
        "data": ["emotes": ["search": ["pageCount": 1, "items": "none"]]]
      ])
    ]
    for data in invalid {
      #expect(throws: APIError.malformedResponse) {
        try DiscoveryParser.page(from: data)
      }
    }
  }

  @Test
  func `tags are trimmed, distinct and capped`() {
    let tags = DiscoveryParser.tags((0 ..< 40).map { "t\($0)" } + ["t1"])
    #expect(tags.count == DiscoveryParser.maxTags && tags.first == "t0")
  }

  private static func body(_ mode: DiscoveryMode, _ page: Int, _ filter: EmoteFilter) throws
    -> [String: Any]
  {
    let data = try JSONEncoder().encode(SevenTVSearchRequest(mode, page: page, filter: filter))
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  @Test
  func `requests carry the ranking, page and server-side filters`() throws {
    var filter = EmoteFilter()
    filter.query = "  cat "
    filter.motion = .still
    filter.overlay = .overlaying
    filter.tags = "Cute, meme"
    let body = try Self.body(.trending, 2, filter)
    #expect(body["query"] as? String == DiscoveryParser.query)
    let variables = try #require(body["variables"] as? [String: Any])
    #expect(variables["query"] as? String == "cat")
    #expect(variables["page"] as? Int == 2)
    #expect(variables["perPage"] as? Int == SevenTVDiscovery.pageSize)
    let sort = variables["sort"] as? [String: String]
    #expect(sort == ["sortBy": "TRENDING_WEEKLY", "order": "DESCENDING"])
    let filters = try #require(variables["filters"] as? [String: Bool])
    #expect(filters == ["nsfw": false, "animated": false, "defaultZeroWidth": true])
    let tags = variables["tags"] as? [String: Any]
    #expect(tags?["tags"] as? [String] == ["cute", "meme"] && tags?["match"] as? String == "ALL")

    let plainVariables = try #require(Self
      .body(.top, 1, EmoteFilter())["variables"] as? [String: Any])
    #expect((plainVariables["sort"] as? [String: String])?["sortBy"] == "TOP_ALL_TIME")
    #expect(plainVariables["tags"] == nil)
    #expect(plainVariables["filters"] as? [String: Bool] == ["nsfw": false])
  }

  @Test
  func `pages are fetched from 7TV and failures are classified`() async throws {
    let found = try StubTransport.Reply.response(status: 200, body: Self.page([Self.item()]))
    let transport = StubTransport([
      found,
      .response(status: 500, body: Data()),
      .failure(.timedOut)
    ])
    let discovery = SevenTVDiscovery(transport: transport)
    let page = try await discovery.page(.top, number: 1, filter: EmoteFilter())
    #expect(page.emotes.count == 1)
    #expect(transport.requests.first?.url?.absoluteString == "https://7tv.io/v4/gql")
    #expect(transport.requests.first?.httpMethod == "POST")
    await #expect(throws: APIError.self) {
      try await discovery.page(.top, number: 2, filter: EmoteFilter())
    }
    await #expect(throws: APIError.network) {
      try await discovery.page(.top, number: 3, filter: EmoteFilter())
    }
  }

  @Test
  func `discovered emotes take the server's state`() {
    let discovered = CatalogEmote(
      name: "peepoHey",
      source: .sevenTV,
      image: "/7tv-cdn/emote/A/2x.webp",
      isAnimated: true,
      sevenTVID: Self.id
    )
    let known = CatalogEmote(
      name: "hey",
      source: .sevenTV,
      image: "/7tv-cdn/emote/A/2x.webp",
      isAnimated: true,
      isAdded: true,
      composeToken: "hey",
      sevenTVID: Self.id
    )
    let added = Catalog(emotes: [known], canManageEmotes: true, canComposeDiscovery: false)
    #expect(added.resolving(discovered).isAdded)
    #expect(added.resolving(discovered).composeToken == "hey")
    let open = Catalog(emotes: [], canManageEmotes: false, canComposeDiscovery: true)
    #expect(open.resolving(discovered).composeToken == "7tv:\(Self.id)")
    let closed = Catalog(emotes: [], canManageEmotes: false, canComposeDiscovery: false)
    #expect(closed.resolving(discovered).composeToken == nil)
    let foreign = CatalogEmote(
      name: "x",
      source: .betterTTV,
      image: "/bttv-cdn/x",
      isAnimated: false
    )
    #expect(open.resolving(foreign) == foreign)
    #expect(added.resolving([discovered, foreign]) == [added.resolving(discovered), foreign])
    #expect(closed.resolving([discovered]).first?.composeToken == nil)
  }

  @Test
  func `7TV IDs accept both supported formats`() {
    #expect(SevenTVID.isValid("60ae958e229664e8667aea38"))
    #expect(SevenTVID.isValid(Self.id))
    #expect(!SevenTVID.isValid("60ae958e229664e8667aeaZZ"))
    #expect(!SevenTVID.isValid("short"))
    #expect(!SevenTVID.isValid("0123456789012345678901234!"))
  }

  @Test
  func `missing tags and overlay flags default to none`() throws {
    var item = Self.item()
    item["tags"] = nil
    var flags = try #require(item["flags"] as? [String: Any])
    flags["defaultZeroWidth"] = nil
    item["flags"] = flags
    let emote = try #require(DiscoveryParser.page(from: Self.page([item])).emotes.first)
    #expect(emote.tags.isEmpty)
    #expect(!emote.isOverlay)
  }

  @Test
  func `malformed optional fields and image entries are skipped`() throws {
    var item = Self.item(flags: ["defaultZeroWidth": "yes"], tags: [])
    item["tags"] = "wave"
    item["images"] = [
      "not an object",
      ["url": 4],
      ["url": "https://cdn.7tv.app/emote/\(Self.id)/2x.webp"]
    ]
    let emote = try #require(DiscoveryParser.page(from: Self.page([item])).emotes.first)
    #expect(emote.tags.isEmpty && !emote.isOverlay)
    #expect(emote.image == "/7tv-cdn/emote/\(Self.id)/2x.webp" && emote.preview == nil)
  }
}
