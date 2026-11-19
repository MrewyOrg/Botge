import XCTest

final class DiscoveryUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  @MainActor
  func testTrendingShowsDiscoveredEmotesThatCanBeAdded() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    let server = app.buttons["server.100000000000000001"]
    XCTAssertTrue(server.waitForExistence(timeout: 5))
    server.tap()
    XCTAssertTrue(app.buttons["emote.peepoHey"].waitForExistence(timeout: 5))

    app.segmentedControls["emotes.source"].buttons["Trending"].tap()
    let discovered = app.buttons["emote.catJAM"]
    XCTAssertTrue(discovered.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["emote.peepoHey"].exists)

    discovered.tap()
    XCTAssertTrue(app.buttons["Add to Server"].waitForExistence(timeout: 5))
    app.buttons["preview.close"].tap()

    app.buttons["emotes.select"].tap()
    XCTAssertTrue(discovered.waitForExistence(timeout: 5))
    discovered.tap()
    let batch = app.buttons["emotes.batch"]
    XCTAssertTrue(batch.waitForExistence(timeout: 5))
    XCTAssertEqual(batch.label, "Add 1 to Server")
  }

  @MainActor
  func testEachSourceKeepsItsOwnSearch() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()

    let server = app.buttons["server.100000000000000001"]
    XCTAssertTrue(server.waitForExistence(timeout: 5))
    server.tap()
    let search = app.searchFields.firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("kap")
    XCTAssertTrue(app.buttons["emote.Kappa"].waitForExistence(timeout: 5))

    let sources = app.segmentedControls["emotes.source"]
    sources.buttons["Trending"].tap()
    XCTAssertTrue(app.buttons["emote.catJAM"].waitForExistence(timeout: 5))
    XCTAssertNotEqual(search.value as? String, "kap")

    sources.buttons["Server"].tap()
    XCTAssertTrue(app.buttons["emote.Kappa"].waitForExistence(timeout: 5))
    XCTAssertEqual(search.value as? String, "kap")
    XCTAssertFalse(app.buttons["emote.peepoHey"].exists)
  }
}
