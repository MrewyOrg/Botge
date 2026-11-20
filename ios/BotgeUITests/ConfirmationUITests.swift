import XCTest

final class ConfirmationUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  /// Launches the fixture app on `tab`, with the fixture server picked.
  @MainActor
  private func launch(on tab: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    app.tabBars.buttons[tab].tap()
    let server = app.buttons["server.100000000000000001"]
    if server.waitForExistence(timeout: 5) {
      server.tap()
    }
    return app
  }

  @MainActor
  func testLoggingOutAsksFirstAndReturnsToLogin() {
    let app = launch(on: "Settings")
    let logout = app.buttons["settings.logout"]
    for _ in 0 ..< 3 where !logout.isHittable {
      app.swipeUp()
    }
    logout.tap()
    let confirm = app.buttons["Log Out"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
    XCTAssertTrue(app.buttons["login.discord"].waitForExistence(timeout: 5))
  }

  @MainActor
  func testClearingTheImageCacheAsksFirst() {
    let app = launch(on: "Settings")
    app.buttons["Cache & Storage"].tap()
    app.buttons["storage.clear"].tap()
    let confirm = app.buttons
      .matching(
        NSPredicate(
          format: "label == %@ AND identifier != %@",
          "Clear Image Cache",
          "storage.clear"
        )
      )
      .firstMatch
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
    XCTAssertFalse(confirm.waitForExistence(timeout: 2))
  }

  @MainActor
  func testLeavingAsksFirstOnlyDuringAMatch() {
    let app = launch(on: "Guess")
    app.buttons["guess.create"].tap()
    let leave = app.buttons["guess.leave"]
    XCTAssertTrue(leave.waitForExistence(timeout: 5))
    leave.tap()
    XCTAssertTrue(app.buttons["guess.create"].waitForExistence(timeout: 5))

    app.buttons["guess.create"].tap()
    let start = app.buttons["guess.start"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    start.tap()
    XCTAssertTrue(app.staticTexts["guess.hint"].waitForExistence(timeout: 10))
    leave.tap()
    let confirm = app.buttons["Leave Match"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
    XCTAssertTrue(app.buttons["guess.create"].waitForExistence(timeout: 5))
  }

  @MainActor
  func testSwitchingServersWithUnsavedChangesAsksFirst() {
    let app = launch(on: "Server")
    let everyone = app.switches["server.managers.everyone"].switches.firstMatch
    XCTAssertTrue(everyone.waitForExistence(timeout: 5))
    everyone.tap()
    app.buttons["servers.switch"].tap()
    app.buttons["Second Server"].tap()
    let confirm = app.buttons["Switch Servers"]
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
    XCTAssertTrue(app.staticTexts[
      "Only server administrators can change Botge's voice settings and emote sources."
    ]
    .waitForExistence(timeout: 5))
  }

  @MainActor
  func testCancellingTheDiscordLoginShowsNoError() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launchEnvironment["BOTGE_UI_TEST_SIGNED_OUT"] = "1"
    app.launch()
    let login = app.buttons["login.discord"]
    XCTAssertTrue(login.waitForExistence(timeout: 5))
    login.tap()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let cancel = springboard.buttons["Cancel"]
    // The system sign-in prompt can take several seconds in Lockdown Mode.
    if cancel.waitForExistence(timeout: 15) {
      cancel.tap()
    } else {
      app.buttons["Cancel"].firstMatch.tap()
    }
    XCTAssertTrue(login.waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["login.error"].exists)
  }
}
