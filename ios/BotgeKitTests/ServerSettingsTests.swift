@testable import BotgeKit
import Foundation
import Testing

struct ServerSettingsTests {
  @Test
  func `voice status is trimmed, blank text is dropped and long text is rejected`() {
    #expect(VoiceSettings(status: "  🌴 ").normalized.status == "🌴")
    #expect(VoiceSettings(status: "   ").normalized.status == nil)
    #expect(VoiceSettings(status: nil).normalized.status == nil)
    #expect(VoiceSettings(status: "   ").isStatusValid)
    #expect(VoiceSettings(status: String(repeating: "a", count: 128)).isStatusValid)
    #expect(!VoiceSettings(status: String(repeating: "a", count: 129)).isStatusValid)
    #expect(!VoiceSettings(status: String(repeating: "🌴", count: 33)).isStatusValid)
    #expect(!VoiceSettings(status: "a\u{7}b").isStatusValid)
  }

  @Test
  func `a saved channel Botge can no longer join stays selectable`() {
    let channels = [VoiceChannel(id: "1", name: "General")]
    let current = VoiceOptions(settings: VoiceSettings(channelID: "1"), channels: channels)
    #expect(current.choices == channels)
    let stale = VoiceOptions(settings: VoiceSettings(channelID: "2"), channels: channels)
    #expect(stale.choices.map(\.id) == ["1", "2"])
    #expect(VoiceOptions(settings: VoiceSettings(), channels: channels).choices == channels)
  }

  @Test
  func `voice settings encode the Activity's field names and omit cleared values`() throws {
    let data = try JSONEncoder().encode(VoiceSettings(isStatusEnabled: true))
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Bool]
    #expect(object == ["statusEnabled": true])
    let decoded = try JSONDecoder().decode(
      VoiceSettings.self,
      from: Data(#"{"channelId":"5","statusEnabled":false,"statusEmoji":null}"#.utf8)
    )
    #expect(decoded == VoiceSettings(channelID: "5"))
  }

  @Test
  func `emote policies are normalized and validated like the server`() {
    let policy = EmotePolicy(
      sevenTVSet: " 01234567890123456789ABCDEF "
    )
    #expect(policy.normalized.sevenTVSet == "01234567890123456789ABCDEF")
    #expect(policy.isValid)
    #expect(!EmotePolicy(sevenTVSet: "short").isSevenTVSetValid)
    #expect(!EmotePolicy(allowedRoleIDs: (0 ... 25).map(String.init)).isValid)
  }

  @Test
  func `policy options decode flattened fields and keep unavailable roles`() throws {
    let json = #"{"sevenTvSet":null,"allowEveryone":true,"#
      + #""allowedRoles":["7","9"],"roles":[{"id":"7","name":"Mods"},{"id":"8","name":"VIP"}]}"#
    let options = try JSONDecoder().decode(EmotePolicyOptions.self, from: Data(json.utf8))
    #expect(options.policy.allowsEveryone)
    #expect(options.choices.map(\.id) == ["7", "8", "9"])
    #expect(options == EmotePolicyOptions(policy: options.policy, roles: options.roles))
  }

  @Test
  func `border colors parse and print six hexadecimal digits`() {
    #expect(BorderColor(hex: "#00ff7F")?.hex == "00FF7F")
    #expect(BorderColor(hex: "0A0B0C")?.green == 0x0B)
    for text in ["", "#12345", "1234567", "GGGGGG", "+12345"] {
      #expect(BorderColor(hex: text) == nil)
    }
    let color = BorderColor(red: 300, green: -4, blue: 16)
    #expect(color.hex == "FF0010")
    #expect([color.red, color.green, color.blue] == [Int]([255, 0, 16]))
  }

  @Test
  func `server initials take the first letter of up to three words`() {
    let initials = ["Botge Fan Club Server", "Solo", "  ", "#1 fans & co"].map { name in
      SharedGuild(id: "1", name: name, icon: nil, isAdministrator: false).initials
    }
    #expect(initials == ["BFC", "S", "", "#f&"])
  }
}
