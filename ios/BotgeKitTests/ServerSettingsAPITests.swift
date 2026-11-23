@testable import BotgeKit
import Foundation
import Testing

struct ServerSettingsAPITests {
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
    let api = try TestAPI.signedIn(transport)
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
    let policy = #"{"sevenTvSet":null,"#
      + #""allowEveryone":false,"allowedRoles":["7"],"roles":[{"id":"7","name":"Mods"}]}"#
    let transport = StubTransport([Self.reply(policy), Self.reply(policy)])
    let api = try TestAPI.signedIn(transport)
    let loaded = try await api.emotePolicy(guild: "1")
    #expect(loaded.policy.allowedRoleIDs == ["7"])

    var draft = loaded.policy
    draft.sevenTVSet = " 01234567890123456789ABCDEF "
    _ = try await api.saveEmotePolicy(draft, guild: "1")
    let sent = try #require(Self.body(transport.requests[1])["emotes"] as? [String: Any])
    #expect(sent["sevenTvSet"] as? String == "01234567890123456789ABCDEF")
    #expect(sent["allowedRoles"] as? [String] == ["7"])
    #expect(transport.requests.compactMap { $0.url?.path() }.last
      == "/botge-api/app/v1/settings/emotes")

    draft.sevenTVSet = "nope"
    await #expect(throws: APIError.rejected("Check the emote sources and roles.")) {
      try await api.saveEmotePolicy(draft, guild: "1")
    }
  }

  @Test
  func `catalog restore confirms the revision that was previewed`() async throws {
    let history = #"{ "currentRevision":3,"revisions":[{"revision":1,"recordedAt":100,"#
      + #""actorId":"18446744073709551615","edit":{"type":"baseline"}}]}"#
    let preview = #"{ "currentRevision":3,"targetRevision":1,"added":["Wave"],"removed":[],"#
      + #""updated":[],"orderChanged":false,"#
      + #""currentSettings":{"allowEveryone":false,"allowedRoles":[]},"#
      + #""restoredSettings":{"allowEveryone":true,"allowedRoles":[]}}"#
    let transport = StubTransport([
      Self.reply(history),
      Self.reply(preview),
      Self.reply(#"{"currentRevision":4}"#)
    ])
    let api = try TestAPI.signedIn(transport)
    let entries = try await api.catalogHistory(guild: "1")
    #expect(entries.revisions.first?.actorID == "18446744073709551615")
    let changes = try await api.previewCatalogRestore(revision: 1, guild: "1")
    #expect(changes.hasChanges)
    #expect(changes.added == ["Wave"])
    #expect(try await api.restoreCatalog(changes, guild: "1") == 4)
    let sent = try Self.body(transport.requests[2])
    #expect(sent["guildId"] as? String == "1")
    #expect(sent["revision"] as? Int == 1)
    #expect(sent["expectedRevision"] as? Int == 3)
    #expect(try Self.body(transport.requests[1])["expectedRevision"] == nil)
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
    let api = try TestAPI.signedIn(transport)
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
