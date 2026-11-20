@testable import Botge
import BotgeKit
import Testing
import ViewInspector

struct LockAndLoginViewTests {
  @Test
  func `the lock screen unlocks from its button unless authenticating`() throws {
    var unlocks = 0
    let screen = AppLockScreen(isAuthenticating: false) { unlocks += 1 }
    try screen.inspect().find(button: "Unlock").tap()
    #expect(unlocks == 1)
    let busy = AppLockScreen(isAuthenticating: true) { unlocks += 1 }
    #expect(try busy.inspect().find(button: "Unlock").isDisabled())
  }

  @Test(arguments: [
    ConfigurationError.missingAPIBaseURL,
    .invalidAPIBaseURL,
    .missingApplicationID,
    .invalidApplicationID
  ])
  func `configuration errors name the setting to fix`(error: ConfigurationError) throws {
    let text = try ConfigurationErrorView(error: error).inspect().find(ViewType.Text.self) { text in
      try text.string().contains("_")
    }
    #expect(try !text.string().isEmpty)
  }

  @Test
  func `the login header shows the app name`() throws {
    #expect(throws: Never.self) { try LoginHeader().inspect().find(text: "Botge") }
  }
}
