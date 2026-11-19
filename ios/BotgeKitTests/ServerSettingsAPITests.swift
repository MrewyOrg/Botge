@testable import BotgeKit
import Foundation
import Testing

struct ServerSettingsAPITests {
  private static let base: URL? = URL(string: "https://botge.example.com/botge-api/app/v1")

  private static func api(_ transport: StubTransport) throws -> BotgeAPI {
    let store = MemorySecretStore()
    let tokens = OAuthTokens(
      accessToken: "t",
      refreshToken: nil,
      expiresAt: .distantFuture,
      scope: "identify"
    )
    try store.write(JSONEncoder().encode(tokens), for: AuthSession.tokenKey)
    let oauth = DiscordOAuth(applicationID: "123456789012345678")
    let session = AuthSession(oauth: oauth, transport: transport, store: store)
    return try BotgeAPI(baseURL: #require(base), session: session, transport: transport)
  }

  private static func body(_ request: URLRequest) throws -> [String: Any] {
    let data = try #require(request.httpBody)
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  private static func reply(_ json: String) -> StubTransport.Reply {
    .response(status: 200, body: Data(json.utf8))
  }

  @Test
  func `voice settings load and save the normalized preference`() async throws {
    let voice = #"{"voice":{"channelId":"5","statusEnabled":true,"statusEmoji":"🌴"},"#
      + #""channels":[{"id":"5","name":"Lounge"}]}"#
    let transport = StubTransport([Self.reply(voice), Self.reply(voice)])
    let api = try Self.api(transport)
    let loaded = try await api.voiceOptions(guild: "1")
    #expect(loaded.settings.status == "🌴")
    #expect(loaded.channels == [VoiceChannel(id: "5", name: "Lounge")])

    let draft = VoiceSettings(channelID: "5", isStatusEnabled: true, status: " 🌴 ")
    #expect(try await api.saveVoice(draft, guild: "1") == loaded)
    let sent = try Self.body(transport.requests[1])
    #expect(sent["guildId"] as? String == "1")
    let saved = try #require(sent["voice"] as? [String: Any])
    #expect(saved["statusEmoji"] as? String == "🌴")
    #expect(transport.requests.compactMap { $0.url?.lastPathComponent } == ["settings", "voice"])

    let long = VoiceSettings(status: String(repeating: "a", count: 129))
    await #expect(throws: APIError.self) { try await api.saveVoice(long, guild: "1") }
    #expect(transport.requests.count == 2)
  }

  @Test
  func `emote policies load, save and stop invalid input before sending`() async throws {
    let policy = #"{"sevenTvSet":null,"bttvTwitchId":null,"ffzChannel":"chan","#
      + #""allowEveryone":false,"allowedRoles":["7"],"roles":[{"id":"7","name":"Mods"}]}"#
    let transport = StubTransport([Self.reply(policy), Self.reply(policy)])
    let api = try Self.api(transport)
    let loaded = try await api.emotePolicy(guild: "1")
    #expect(loaded.policy.allowedRoleIDs == ["7"])

    var draft = loaded.policy
    draft.frankerFaceZChannel = " Chan "
    _ = try await api.saveEmotePolicy(draft, guild: "1")
    let sent = try #require(Self.body(transport.requests[1])["emotes"] as? [String: Any])
    #expect(sent["ffzChannel"] as? String == "chan")
    #expect(sent["allowedRoles"] as? [String] == ["7"])
    #expect(transport.requests.compactMap { $0.url?.path() }.last
      == "/botge-api/app/v1/settings/emotes")

    draft.sevenTVSet = "nope"
    await #expect(throws: APIError.rejected("Check the emote sources and roles.")) {
      try await api.saveEmotePolicy(draft, guild: "1")
    }
  }

  @Test
  func `border colors load, save, clear and reject malformed answers`() async throws {
    let transport = StubTransport([
      StubTransport.json(200, ["color": "00FF7F"]),
      StubTransport.json(200, ["color": "102030"]),
      StubTransport.json(200, ["color": ""]),
      StubTransport.json(200, ["color": "nope"]),
      StubTransport.json(403, ["message": "Not a member."])
    ])
    let api = try Self.api(transport)
    #expect(try await api.borderColor(guild: "1") == BorderColor(hex: "00FF7F"))
    let color = BorderColor(red: 16, green: 32, blue: 48)
    #expect(try await api.saveBorderColor(color, guild: "1") == color)
    #expect(try Self.body(transport.requests[1])["color"] as? String == "102030")
    #expect(try await api.saveBorderColor(nil, guild: "1") == nil)
    #expect(try (Self.body(transport.requests[2])["color"] as? String)?.isEmpty == true)
    await #expect(throws: APIError.malformedResponse) { try await api.borderColor(guild: "1") }
    await #expect(throws: APIError.permissionDenied("Not a member.")) {
      try await api.voiceOptions(guild: "1")
    }
  }
}
