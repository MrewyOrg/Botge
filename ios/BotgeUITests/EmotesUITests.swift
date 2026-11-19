import XCTest

final class EmotesUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  @MainActor
  func testPreviewComposeAndSearchEmotes() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    let server = app.buttons["server.100000000000000001"]
    XCTAssertTrue(server.waitForExistence(timeout: 5))
    server.tap()

    let wave = app.buttons["emote.peepoHey"]
    XCTAssertTrue(wave.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["emote.Kappa"].exists)

    wave.tap()
    let add = app.buttons["Add to Composition"]
    XCTAssertTrue(add.waitForExistence(timeout: 5))
    add.tap()
    app.buttons["Done"].firstMatch.tap()
    XCTAssertTrue(add.waitForNonExistence(timeout: 5))

    let compose = app.buttons["emotes.compose"]
    XCTAssertTrue(compose.waitForExistence(timeout: 5))
    compose.tap()
    let text = app.staticTexts["composer.text"]
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    XCTAssertEqual(text.label, "peepoHey")
    app.buttons["Done"].firstMatch.tap()
    XCTAssertTrue(text.waitForNonExistence(timeout: 5))

    let search = app.searchFields.firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("kap")
    XCTAssertTrue(app.buttons["emote.Kappa"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["emote.peepoHey"].exists)
  }
}
