import XCTest

final class ConfirmationUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  /// Launches the fixture app on `tab`, with the fixture server picked.
  @MainActor
  private func launch(on tab: String, environment: [String: String] = [:]) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment = environment
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    app.tabBars.buttons[tab].tap()
    let server = app.buttons["server.100000000000000001"]
    if server.waitForExistence(timeout: 5) {
      server.tap()
    }
    return app
  }

  /// Scrolls the history or settings list until its control can be reached.
  @MainActor
  private func reveal(_ control: XCUIElement, in app: XCUIApplication) {
    for _ in 0 ..< 4 where !control.isHittable {
      app.swipeUp()
    }
    XCTAssertTrue(control.isHittable)
  }

  /// Opens catalog history from the administrator's Server tab.
  @MainActor
  private func openHistory(in app: XCUIApplication) {
    let link = app.buttons["server.catalog-history"]
    reveal(link, in: app)
    link.tap()
  }

  /// Previews the baseline and confirms the requested restore.
  @MainActor
  private func restoreBaseline(in app: XCUIApplication) {
    let baseline = app.buttons["history.revision.0"]
    reveal(baseline, in: app)
    baseline.tap()
    // The preview is inserted at the top, above the revision that was tapped.
    let restore = app.buttons["history.preview.restore"]
    for _ in 0 ..< 4 where !restore.isHittable {
      app.swipeDown()
    }
    XCTAssertTrue(restore.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Restore the previous catalog order."].exists)
    restore.tap()
    let confirm = app.buttons.matching(identifier: "history.confirm").firstMatch
    XCTAssertTrue(confirm.waitForExistence(timeout: 5))
    confirm.tap()
  }

  @MainActor
  func testCatalogHistoryPreviewsBeforeConfirmingRestore() {
    let app = launch(on: "Server")
    openHistory(in: app)
    let latest = app.buttons["history.revision.5"]
    XCTAssertTrue(latest.waitForExistence(timeout: 5))
    latest.tap()
    XCTAssertTrue(app.staticTexts["This revision already matches the saved catalog."]
      .waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["history.preview.restore"].exists)

    restoreBaseline(in: app)
    XCTAssertTrue(app.staticTexts["Restore saved as revision #6."].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["history.revision.6"].exists)
  }

  @MainActor
  func testCatalogHistoryRecoversFromUnavailablePreviewAndRefresh() {
    let app = launch(on: "Server", environment: ["BOTGE_UI_HISTORY_RECOVERY": "1"])
    openHistory(in: app)
    XCTAssertTrue(app.staticTexts["No catalog changes have been recorded."]
      .waitForExistence(timeout: 5))
    let refresh = app.buttons["history.refresh"]
    refresh.tap()
    let unavailable = app.buttons["history.revision.4"]
    XCTAssertTrue(unavailable.waitForExistence(timeout: 5))
    unavailable.tap()
    XCTAssertTrue(app
      .staticTexts["Botge could not be reached. Check your connection and try again."]
      .waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["history.preview.restore"].exists)

    restoreBaseline(in: app)
    XCTAssertTrue(app.staticTexts["Restore saved as revision #6. Refresh to load history."]
      .waitForExistence(timeout: 5))
    refresh.tap()
    XCTAssertTrue(app.buttons["history.revision.6"].waitForExistence(timeout: 5))
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
