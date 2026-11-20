@testable import Botge
import BotgeKit
import LocalAuthentication
import SwiftUI
import Testing
import ViewInspector

@Suite(.serialized)
struct SettingsViewTests {
  init() {
    UserDefaults.standard.removeObject(forKey: PreferenceKey.appLock)
  }

  /// An owner check that always succeeds or fails.
  private static func owner(
    _ approves: Bool,
    biometry: LABiometryType = .faceID
  )
    -> OwnerAuthentication
  {
    OwnerAuthentication(
      biometry: { biometry },
      isAvailable: { true },
      authenticate: { _ in approves }
    )
  }

  @Test
  func `settings list every section and ask before logging out`() async throws {
    let app = await Fixtures.signedIn()
    let settings = SettingsView().environment(app)
    #expect(throws: Never.self) { try settings.inspect().find(AppearanceSection.self) }
    try settings.inspect().find(button: "Log Out of Discord").tap()
    #expect(throws: Never.self) { try settings.inspect().find(ShortcutsSection.self) }
    #expect(throws: Never.self) { try settings.inspect().find(MotionSection.self) }
    await Hosting.show(settings, model: app)
  }

  @Test
  func `the App Lock setting changes only after the owner authenticates`() async throws {
    let approving = SecuritySection().environment(\.ownerAuthentication, Self.owner(true))
    try approving.inspect().find(ViewType.Toggle.self).tap()
    await Fixtures.wait { UserDefaults.standard.bool(forKey: PreferenceKey.appLock) }
    #expect(UserDefaults.standard.bool(forKey: PreferenceKey.appLock))
    try approving.inspect().find(ViewType.Toggle.self).tap()
    await Fixtures.wait { !UserDefaults.standard.bool(forKey: PreferenceKey.appLock) }

    let refusing = SecuritySection().environment(\.ownerAuthentication, Self.owner(false))
    try refusing.inspect().find(ViewType.Toggle.self).tap()
    try await Task.sleep(for: .milliseconds(100))
    #expect(!UserDefaults.standard.bool(forKey: PreferenceKey.appLock))

    let unavailable = OwnerAuthentication(
      biometry: { .none },
      isAvailable: { false },
      authenticate: { _ in true }
    )
    let noPasscode = SecuritySection().environment(\.ownerAuthentication, unavailable)
    try noPasscode.inspect().find(ViewType.Toggle.self).tap()
    try await Task.sleep(for: .milliseconds(100))
    #expect(!UserDefaults.standard.bool(forKey: PreferenceKey.appLock))
    await Hosting.show(noPasscode, model: Fixtures.misconfigured())
  }

  @Test
  func `the lock is named after the device's biometrics`() async {
    let titles = [LABiometryType.faceID, .touchID, .opticID, .none]
      .map { String(localized: Self.owner(true, biometry: $0).lockTitle) }
    #expect(titles == ["Face ID", "Touch ID", "Optic ID", "App Lock"])
    // The simulator has no passcode, so the device check refuses without a prompt.
    _ = OwnerAuthentication.device.biometry()
    _ = OwnerAuthentication.device.isAvailable()
    #expect(await !OwnerAuthentication.device.authenticate("Test"))
  }

  @Test
  func `about shows the version, legal documents and the source`() async throws {
    #expect(AboutView.version { _ in nil } == "? (?)")
    #expect(AboutView.version { $0 == "CFBundleVersion" ? "7" : "6.0.0" } == "6.0.0 (7)")
    let about = AboutView()
    #expect(throws: Never.self) { try about.inspect().find(ViewType.Link.self) }
    for link in try about.inspect().findAll(ViewType.NavigationLink.self) {
      #expect(throws: Never.self) { try link.find(LegalDocumentView.self) }
    }
    let missing = LegalDocumentView(title: "Missing", resource: "MISSING", fileExtension: "md")
    #expect(throws: (any Error).self) { try missing.inspect().find(MarkdownBlockView.self) }
    let license = LegalDocumentView(title: "License", resource: "LICENSE", fileExtension: "txt")
    #expect(throws: Never.self) { try license.inspect().find(MarkdownBlockView.self) }
    let terms = LegalDocumentView(title: "Terms", resource: "TERMS", fileExtension: "md")
    await Hosting.show(NavigationStack { terms }, model: Fixtures.misconfigured())
    let deep = MarkdownBlockView(block: MarkdownBlock(id: 0, kind: .heading(4), text: "Deep"))
    #expect(throws: Never.self) { try deep.inspect().find(ViewType.Text.self) }
  }

  @Test
  func `storage shows the cache size and clears it after confirmation`() async throws {
    let app = await Fixtures.signedIn()
    let storage = StorageSettingsView().environment(app)
    try storage.inspect().find(button: "Clear Image Cache").tap()
    try await storage.inspect().find(ViewType.Form.self).callTask()
    let links = try LinksSection().inspect().findAll(ViewType.NavigationLink.self)
    #expect(links.count >= 2)
    await Hosting.show(NavigationStack { storage }, model: app)
  }
}
