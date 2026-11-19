import XCTest

/// Makes the Lockdown test plan fail when the device does not report Lockdown Mode.
///
/// iOS stores Lockdown Mode in the global `LDMGlobalEnabled` default, which WebKit reads. The
/// Lockdown plan sets `BOTGE_EXPECT_LOCKDOWN`; other plans skip this test.
final class LockdownModeUITests: XCTestCase {
  deinit {
    // XCTest owns the test case lifecycle; nothing to release.
  }

  @MainActor
  func testLockdownModeIsOnWhenTheLockdownPlanRuns() throws {
    try XCTSkipUnless(
      ProcessInfo.processInfo.environment["BOTGE_EXPECT_LOCKDOWN"] == "1",
      "Only the Lockdown test plan checks the device setting."
    )
    XCTAssertTrue(
      UserDefaults.standard.bool(forKey: "LDMGlobalEnabled"),
      "Turn Lockdown Mode on, or run npm run test:ios:lockdown to prepare the simulator."
    )
  }
}
