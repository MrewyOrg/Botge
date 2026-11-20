@testable import Botge
import BotgeKit
import SwiftUI
import Testing
import ViewInspector

@Suite(.serialized)
struct ServersViewTests {
  init() {
    UserDefaults.standard.removeObject(forKey: PreferenceKey.defaultGuildID)
  }

  @Test
  func `the picker loads, lists and remembers servers`() async throws {
    let app = await Fixtures.signedIn()
    let picker = ServerPickerView().environment(app)
    #expect(throws: Never.self) { try picker.inspect().find(ViewType.ProgressView.self) }
    await app.loadGuilds()
    try picker.inspect().find(ViewType.Button.self).tap()
    #expect(UserDefaults.standard.string(forKey: PreferenceKey.defaultGuildID) == Fixtures.guild.id)
    nonisolated(unsafe) let group = try picker.inspect().find(ViewType.Group.self)
    try await group.callRefreshable()
  }

  @Test
  func `the picker explains failures and an empty list`() async throws {
    let replies: [RoutedTransport.Reply] = [
      .failure(.timedOut),
      .json(status: 200, body: #"{"guilds":[]}"#)
    ]
    let transport = RoutedTransport(["guilds": replies])
    let app = await Fixtures.signedIn(transport: transport)
    await app.loadGuilds()
    let picker = ServerPickerView().environment(app)
    try picker.inspect().find(button: "Try Again").tap()
    await Fixtures.wait { app.hasLoadedGuilds }
    #expect(throws: Never.self) { try picker.inspect().find(ViewType.ContentUnavailableView.self) }
  }

  @Test
  func `rows show icons, roles and the selection at every text size`() async throws {
    let icon = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).png")
    try? UIImage(systemName: "star")?.pngData()?.write(to: icon)
    let iconic = SharedGuild(id: "1", name: "Icon Server", icon: icon, isAdministrator: false)
    let selected = ServerRow(guild: Fixtures.guild, isSelected: true)
    let other = ServerRow(guild: iconic, isSelected: false)
    #expect(throws: Never.self) { try selected.inspect().find(text: "Administrator") }
    #expect(throws: Never.self) {
      try selected.inspect().find(ViewType.Image.self) { image in
        try image.accessibilityLabel().string() == "Selected"
      }
    }
    #expect(throws: (any Error).self) { try other.inspect().find(text: "Administrator") }
    let rows = VStack {
      selected
      other
    }
    await Hosting.show(rows, model: Fixtures.misconfigured(), settle: .milliseconds(600))
    await Hosting.show(
      rows.environment(\.dynamicTypeSize, .accessibility2),
      model: Fixtures.misconfigured()
    )
  }

  @Test
  func `switching servers asks first when it would lose something`() async throws {
    let app = await Fixtures.signedIn()
    await app.loadGuilds()
    let other = SharedGuild(id: "2", name: "Other", icon: nil, isAdministrator: false)
    let switcher = ServerSwitcher(selection: other).environment(app)
    try switcher.inspect().find(ViewType.Picker.self).select(value: Fixtures.guild.id)
    #expect(UserDefaults.standard.string(forKey: PreferenceKey.defaultGuildID) == Fixtures.guild.id)
    try switcher.inspect().find(ViewType.Picker.self).select(value: Fixtures.guild.id)
    app.isPlayingGuess = true
    try switcher.inspect().find(ViewType.Picker.self).select(value: "2")
    #expect(UserDefaults.standard.string(forKey: PreferenceKey.defaultGuildID) == Fixtures.guild.id)
    await Hosting.show(switcher, model: app)
    app.isPlayingGuess = false
    app.hasUnsavedServerChanges = true
    await Hosting.show(switcher, model: app)
  }

  @Test
  func `the scope shows the picker, then the selected server`() async {
    let app = await Fixtures.signedIn()
    let scope = ServerScope { guild in Text(guild.name) }
    await Hosting.show(NavigationStack { scope }, model: app)
    #expect(app.hasLoadedGuilds)
    #expect(throws: Never.self) {
      try scope.environment(app).inspect().find(ServerPickerView.self)
    }
    UserDefaults.standard.set(Fixtures.guild.id, forKey: PreferenceKey.defaultGuildID)
    #expect(throws: Never.self) {
      try scope.environment(app).inspect().find(text: Fixtures.guild.name)
    }
    await Hosting.show(scope, model: app)
  }
}
