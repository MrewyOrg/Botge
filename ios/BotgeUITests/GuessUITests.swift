import XCTest

final class GuessUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  @MainActor
  func testPlayingAFixtureMatchHidesEmotesUntilItEnds() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    app.tabBars.buttons["Guess"].tap()
    let server = app.buttons["server.100000000000000001"]
    if server.waitForExistence(timeout: 5) {
      server.tap()
    }

    app.buttons["guess.create"].tap()
    let start = app.buttons["guess.start"]
    XCTAssertTrue(start.waitForExistence(timeout: 5))
    start.tap()

    let field = app.textFields["guess.field"]
    XCTAssertTrue(app.staticTexts["guess.hint"].waitForExistence(timeout: 10))
    app.tabBars.buttons["Emotes"].tap()
    XCTAssertTrue(app.otherElements["emotes.locked"].waitForExistence(timeout: 5)
      || app.staticTexts["Emotes Hidden"].exists)
    app.tabBars.buttons["Guess"].tap()

    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("dogJAM\n")
    field.typeText("catJAM\n")
    let status = app.staticTexts["guess.status"]
    XCTAssertTrue(app.buttons["guess.start"].waitForExistence(timeout: 10))
    XCTAssertEqual(status.label, "Match over. You win.")
  }
}
