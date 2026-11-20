@testable import Botge
import BotgeKit
import LocalAuthentication
import SwiftUI
import Testing
import ViewInspector

@Suite(.serialized)
struct LockAndRootTests {
  init() {
    UserDefaults.standard.removeObject(forKey: PreferenceKey.appLock)
  }

  @Test
  func `the lock screen covers the app only while App Lock is on`() async throws {
    let approving = OwnerAuthentication(
      biometry: { .faceID },
      isAvailable: { true },
      authenticate: { _ in true }
    )
    let content = Text("Content").appLock().environment(\.ownerAuthentication, approving)
    #expect(throws: (any Error).self) { try content.inspect().find(AppLockScreen.self) }
    UserDefaults.standard.set(true, forKey: PreferenceKey.appLock)
    defer { UserDefaults.standard.removeObject(forKey: PreferenceKey.appLock) }
    try content.inspect().find(button: "Unlock").tap()

    // The scene moves to the background and back, as when switching apps.
    let phase = ScenePhaseBox()
    phase.value = .active
    let locked = LockedText(phase: phase).environment(\.ownerAuthentication, approving)
    await Hosting.show(locked, model: Fixtures.misconfigured()) {
      phase.value = .background
      try? await Task.sleep(for: .milliseconds(200))
      phase.value = .active
    }
  }

  @Test
  func `the root follows the sign-in phase`() async {
    let misconfigured = PhaseView().environment(Fixtures.misconfigured())
    #expect(throws: Never.self) { try misconfigured.inspect().find(ConfigurationErrorView.self) }
    let signedOut = Fixtures.model(signedIn: false)
    await signedOut.restore()
    #expect(throws: Never.self) {
      try PhaseView().environment(signedOut).inspect().find(LoginView.self)
    }
    let signedIn = await Fixtures.signedIn()
    #expect(throws: Never.self) {
      try PhaseView().environment(signedIn).inspect().find(MainTabView.self)
    }
    let restoring = Fixtures.model(signedIn: true)
    #expect(throws: (any Error).self) {
      try PhaseView().environment(restoring).inspect().find(LoginView.self)
    }
    await Hosting.show(RootView(), model: signedIn)
  }

  @Test
  func `app links open their tab and other links change nothing`() throws {
    let app = Fixtures.misconfigured()
    let scheme = "dev.example.botge"
    try app.open(#require(URL(string: "\(scheme)://guess")), scheme: scheme)
    #expect(app.selectedTab == .guess)
    try app.open(#require(URL(string: "\(scheme)://emotes")), scheme: scheme)
    #expect(app.selectedTab == .emotes)
    app.selectedTab = .settings
    try app.open(#require(URL(string: "\(scheme)://unknown")), scheme: scheme)
    try app.open(#require(URL(string: "other.app://guess")), scheme: scheme)
    #expect(app.selectedTab == .settings)
    try app.openAppLink(#require(AppLink.guess.url(scheme: AppLink.scheme(in: .main))))
    #expect(app.selectedTab == .guess)
  }

  @Test
  func `login offers a retry after a retryable failure`() async throws {
    let app = Fixtures.model(signedIn: false)
    await app.restore()
    await app.signIn { url, scheme in
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
      let state = items.first { $0.name == "state" }?.value ?? ""
      return try #require(URL(string: "\(scheme):/authorize/callback?code=c&state=\(state)"))
    }
    let login = LoginView().environment(app)
    #expect(throws: Never.self) { try login.inspect().find(text: "Try Again") }
    #expect(throws: Never.self) { try login.inspect().find(LoginHeader.self) }
  }
}
