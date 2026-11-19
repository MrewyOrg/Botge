import XCTest

final class SettingsUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  @MainActor
  func testSettingsTabShowsAppearancePicker() {
    let app = XCUIApplication()
    app.launchEnvironment["BOTGE_UI_TEST"] = "1"
    app.launch()
    app.tabBars.buttons["Settings"].tap()
    XCTAssertTrue(app.segmentedControls["settings.appearance"].waitForExistence(timeout: 5))
  }
}
