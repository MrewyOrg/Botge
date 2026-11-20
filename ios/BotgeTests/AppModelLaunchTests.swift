@testable import Botge
import Foundation
import Testing

@Suite(.serialized)
struct AppModelLaunchTests {
  @Test
  func `the live model reads the bundle outside UI tests`() {
    let fixture = AppModel.makeLive()
    #expect(fixture.api != nil)
    unsetenv("BOTGE_UI_TEST")
    defer { setenv("BOTGE_UI_TEST", "1", 1) }
    let live = AppModel.makeLive()
    #expect(live.urlCache.diskCapacity > 0)
  }
}
