import XCTest

final class ServerPickerUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  @MainActor
  func testPickingAServerOpensItsFeatures() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    let server = app.buttons["server.100000000000000001"]
    XCTAssertTrue(server.waitForExistence(timeout: 5))
    server.tap()
    XCTAssertTrue(app.staticTexts["Coming Soon"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["servers.switch"].exists)
  }
}
