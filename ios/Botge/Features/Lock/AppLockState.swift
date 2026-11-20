import BotgeKit
import Foundation
import Observation

/// Decides when App Lock covers the app and when it asks for Face ID or the passcode.
///
/// It asks by itself only at launch and when the app returns from the background. Returning from
/// a brief interruption, such as Control Center or the authentication prompt itself, never asks
/// again, so cancelling the prompt leaves the lock screen with its Unlock button instead of
/// prompting in a loop. While a prompt is showing, further requests are ignored.
@Observable
final class AppLockState {
  /// Whether the lock screen covers the app.
  private(set) var isLocked = true
  /// Whether the authentication prompt is showing.
  private(set) var isAuthenticating = false

  /// When to ask again after backgrounding.
  private let policy: AppLockPolicy
  /// When the app last went to the background, or `nil` while it has not since becoming active.
  private var backgroundedAt: Date?
  /// Whether the app has not been active yet in this run.
  private var isLaunching = true

  /// Creates the state for a launch; the app starts locked.
  ///
  /// - Parameter policy: When to ask again after backgrounding.
  init(policy: AppLockPolicy) {
    self.policy = policy
  }

  deinit {
    // The state lives as long as the view it locks.
  }

  /// Notes that App Lock was turned on or off in Settings.
  ///
  /// - Parameter enabled: Whether App Lock is now on.
  func enabledChanged(to enabled: Bool) {
    // Settings just authenticated the owner, so turning the lock on does not lock the app.
    if enabled {
      isLocked = false
    }
  }

  /// Notes that the app went to the background.
  ///
  /// - Parameter date: When it did.
  func enteredBackground(at date: Date) {
    backgroundedAt = date
  }

  /// Notes that the app became active and says whether to ask for authentication now.
  ///
  /// - Parameters:
  ///   - enabled: Whether App Lock is on.
  ///   - now: The current time.
  /// - Returns: Whether to call ``unlock(enabled:owner:)``.
  func becameActive(enabled: Bool, now: Date) -> Bool {
    let returned = backgroundedAt.map { date in
      policy.requiresUnlock(enabled: enabled, backgroundedAt: date, now: now)
    }
    defer {
      backgroundedAt = nil
      isLaunching = false
    }
    if returned == true {
      isLocked = true
    }
    return enabled && isLocked && (isLaunching || returned != nil)
  }

  /// Asks for Face ID or the passcode and unlocks on success.
  ///
  /// - Parameters:
  ///   - enabled: Whether App Lock is on; when it is off, the app unlocks without asking.
  ///   - owner: Checks for the device owner.
  func unlock(enabled: Bool, owner: OwnerAuthentication) async {
    guard enabled else {
      isLocked = false
      return
    }
    guard !isAuthenticating else {
      return
    }

    isAuthenticating = true
    defer { isAuthenticating = false }
    isLocked = await !owner.authenticate(String(localized: "Unlock Botge"))
  }
}
