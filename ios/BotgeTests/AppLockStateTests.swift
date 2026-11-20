@testable import Botge
import BotgeKit
import Foundation
import LocalAuthentication
import Testing

struct AppLockStateTests {
  private static let start: Date = .init(timeIntervalSince1970: 1_000)

  /// An owner check that answers `approves` and counts its prompts.
  private static func owner(_ approves: Bool, prompts: Counter) -> OwnerAuthentication {
    OwnerAuthentication(
      biometry: { .faceID },
      isAvailable: { true },
      authenticate: { _ in
        await prompts.increment()
        return approves
      }
    )
  }

  @Test
  func `launch asks once and success unlocks`() async {
    let lock = AppLockState(policy: AppLockPolicy(gracePeriod: 30))
    let prompts = Counter()
    #expect(lock.becameActive(enabled: true, now: Self.start))
    await lock.unlock(enabled: true, owner: Self.owner(true, prompts: prompts))
    #expect(!lock.isLocked && !lock.isAuthenticating)
    #expect(await prompts.count == 1)
  }

  @Test
  func `a refused prompt stays locked without asking again on its own`() async {
    let lock = AppLockState(policy: AppLockPolicy(gracePeriod: 30))
    let prompts = Counter()
    #expect(lock.becameActive(enabled: true, now: Self.start))
    await lock.unlock(enabled: true, owner: Self.owner(false, prompts: prompts))
    #expect(lock.isLocked)
    // Dismissing the prompt makes the app active again without visiting the background.
    #expect(!lock.becameActive(enabled: true, now: Self.start))
    #expect(lock.isLocked)
  }

  @Test
  func `a second request while the prompt shows never unlocks`() async {
    let lock = AppLockState(policy: AppLockPolicy(gracePeriod: 30))
    let release = AsyncStream<Void>.makeStream()
    let slow = OwnerAuthentication(
      biometry: { .faceID },
      isAvailable: { true },
      authenticate: { _ in
        for await _ in release.stream {
          break
        }
        return false
      }
    )
    let first = Task { await lock.unlock(enabled: true, owner: slow) }
    await Fixtures.wait { lock.isAuthenticating }
    await lock.unlock(enabled: true, owner: slow)
    #expect(lock.isLocked)
    release.continuation.yield()
    await first.value
    #expect(lock.isLocked && !lock.isAuthenticating)
  }

  @Test
  func `returning after the grace period locks and asks, sooner stays open`() async {
    let lock = AppLockState(policy: AppLockPolicy(gracePeriod: 30))
    let prompts = Counter()
    _ = lock.becameActive(enabled: true, now: Self.start)
    await lock.unlock(enabled: true, owner: Self.owner(true, prompts: prompts))
    lock.enteredBackground(at: Self.start)
    #expect(!lock.becameActive(enabled: true, now: Self.start.addingTimeInterval(10)))
    #expect(!lock.isLocked)
    lock.enteredBackground(at: Self.start)
    #expect(lock.becameActive(enabled: true, now: Self.start.addingTimeInterval(31)))
    #expect(lock.isLocked)
  }

  @Test
  func `turning the lock on keeps the app open and turning it off unlocks`() async {
    let lock = AppLockState(policy: AppLockPolicy(gracePeriod: 30))
    #expect(!lock.becameActive(enabled: false, now: Self.start))
    lock.enabledChanged(to: true)
    #expect(!lock.isLocked)
    lock.enabledChanged(to: false)
    #expect(!lock.becameActive(enabled: true, now: Self.start))
    let locked = AppLockState(policy: AppLockPolicy(gracePeriod: 30))
    await locked.unlock(enabled: false, owner: .device)
    #expect(!locked.isLocked)
  }
}
