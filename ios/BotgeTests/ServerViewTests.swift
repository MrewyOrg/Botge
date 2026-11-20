@testable import Botge
import BotgeKit
import SwiftUI
import Testing
import ViewInspector

struct ServerViewTests {
  private static func model(
    _ routes: [String: [RoutedTransport.Reply]] = [:],
    guild: SharedGuild = Fixtures.guild,
    loaded: Bool = true
  )
    async -> ServerModel
  {
    let app = await Fixtures.signedIn(transport: RoutedTransport(routes))
    let model = ServerModel(guild: guild, app: app)
    if loaded {
      await model.load()
    }
    return model
  }

  @Test
  func `the tab shows failures, loading and the settings form`() async throws {
    let failed = await Self.model(["border/read": [.failure(.timedOut)]])
    let failedView = ServerView(model: failed).environment(failed.app)
    try failedView.inspect().find(button: "Try Again").tap()
    let loading = await Self.model(loaded: false)
    #expect(throws: Never.self) {
      try ServerView(model: loading)
        .environment(loading.app)
        .inspect()
        .find(ViewType.ProgressView.self)
    }
    let admin = await Self.model()
    let adminView = ServerView(model: admin).environment(admin.app)
    #expect(throws: Never.self) { try adminView.inspect().find(VoiceSection.self) }
    nonisolated(unsafe) let form = try adminView.inspect().find(ViewType.Form.self)
    try await form.callRefreshable()
    let member = await Self.model(guild: Fixtures.memberGuild)
    #expect(throws: Never.self) {
      try ServerView(model: member).environment(member.app).inspect().find(ViewType.Label.self)
    }
  }

  @Test
  func `edits mark the server as changed and save from the toolbar`() async {
    let model = await Self.model()
    UserDefaults.standard.set(false, forKey: PreferenceKey.haptics)
    defer { UserDefaults.standard.removeObject(forKey: PreferenceKey.haptics) }
    await Hosting.show(NavigationStack { ServerView(model: model) }, model: model.app) {
      model.voiceDraft.isStatusEnabled = true
      try? await Task.sleep(for: .milliseconds(200))
      #expect(model.app.hasUnsavedServerChanges)
      await model.save()
    }
  }

  @Test
  func `sections explain invalid values`() async throws {
    let model = await Self.model()
    model.policyDraft.sevenTVSet = "bad"
    model.policyDraft.betterTTVTwitchID = "abc"
    model.policyDraft.frankerFaceZChannel = "no spaces allowed"
    model.voiceDraft.status = String(repeating: "a", count: VoiceSettings.maxStatusBytes + 1)
    model.voiceDraft.isStatusEnabled = true
    let sources = try EmoteSourcesSection(model: model).inspect()
    #expect(throws: Never.self) {
      try sources.find(ViewType.Text.self) { try $0.string().contains("Twitch user ID") }
    }
    #expect(throws: Never.self) {
      try VoiceSection(model: model).inspect().find(ViewType.Picker.self)
    }
    let managers = EmoteManagersSection(model: model)
    try managers.inspect().find(ViewType.Toggle.self).tap()
    #expect(model.policyDraft.allowsEveryone)
  }

  @Test
  func `the role picker toggles roles and explains an empty list`() async throws {
    let model = await Self.model()
    let picker = RolePickerView(model: model)
    try picker.inspect().find(ViewType.Button.self).tap()
    #expect(model.policyDraft.allowedRoleIDs == ["300000000000000001"])
    #expect(throws: Never.self) { try picker.inspect().find(ViewType.Image.self) }
    let member = await Self.model(guild: Fixtures.memberGuild)
    #expect(throws: Never.self) {
      try RolePickerView(model: member).inspect().find(ViewType.ContentUnavailableView.self)
    }
  }

  @Test
  func `the border section turns the border on and picks its color`() async throws {
    let model = await Self.model()
    let section = BorderSection(model: model)
    try section.inspect().find(ViewType.Toggle.self).tap()
    #expect(model.isBorderEnabled)
    try section.inspect().find(ViewType.ColorPicker.self).select(color: Color(
      red: 0,
      green: 0,
      blue: 1
    ))
    #expect(model.borderPick == BorderColor(red: 0, green: 0, blue: 255))
  }
}
