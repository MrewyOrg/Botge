@testable import BotgeKit
import Foundation
import Testing

struct PreferencesTests {
  @Test
  func `appearance options are shown system first`() {
    #expect(AppearancePreference.displayOrder == [.system, .light, .dark])
  }

  @Test
  func `app lock timeouts are whole seconds`() {
    let timeouts: [AppLockTimeout] = [.immediately, .oneMinute, .fifteenMinutes, .oneHour]
    #expect(timeouts.map(\.interval) == [0, 60, 900, 3_600])
  }

  @Test
  func `app lock asks again after the grace period`() {
    let policy = AppLockPolicy(gracePeriod: 30)
    let now = Date(timeIntervalSince1970: 1_000)
    #expect(!policy.requiresUnlock(enabled: false, backgroundedAt: nil, now: now))
    #expect(policy.requiresUnlock(enabled: true, backgroundedAt: nil, now: now))
    #expect(!policy.requiresUnlock(
      enabled: true,
      backgroundedAt: now.addingTimeInterval(-29),
      now: now
    ))
    #expect(policy.requiresUnlock(
      enabled: true,
      backgroundedAt: now.addingTimeInterval(-30),
      now: now
    ))
  }

  @Test
  func `tokens count as expiring 30 seconds early`() {
    let now = Date(timeIntervalSince1970: 1_000)
    let tokens = OAuthTokens(
      accessToken: "a",
      refreshToken: nil,
      expiresAt: now.addingTimeInterval(31),
      scope: "identify"
    )
    #expect(!tokens.isExpiring(at: now))
    #expect(tokens.isExpiring(at: now.addingTimeInterval(1)))
  }
}
