import XCTest

final class ServerUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  @MainActor
  func testAdministratorChangesAndSavesTheEmotePolicy() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    app.tabBars.buttons["Server"].tap()
    let server = app.buttons["server.100000000000000001"]
    if server.waitForExistence(timeout: 5) {
      server.tap()
    }

    let save = app.buttons["server.save"]
    XCTAssertTrue(save.waitForExistence(timeout: 5))
    XCTAssertFalse(save.isEnabled)

    app.switches["server.managers.everyone"].switches.firstMatch.tap()
    XCTAssertTrue(save.isEnabled)
    XCTAssertTrue(app.buttons["server.discard"].exists)

    save.tap()
    XCTAssertTrue(app.staticTexts["notice"].waitForExistence(timeout: 5))
    XCTAssertFalse(save.isEnabled)
    XCTAssertFalse(app.buttons["server.discard"].exists)
  }
}
