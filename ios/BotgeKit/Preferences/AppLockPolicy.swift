public import Foundation

/// Decides when App Lock asks for Face ID or the device passcode again.
public struct AppLockPolicy: Equatable, Sendable {
  /// How long the app may stay in the background before it locks.
  public let gracePeriod: TimeInterval

  /// Creates a policy; the default grace period is 30 seconds.
  public init(gracePeriod: TimeInterval = 30) {
    self.gracePeriod = gracePeriod
  }

  /// Whether to lock when the app becomes active.
  ///
  /// A cold launch (`backgroundedAt == nil`) always locks while App Lock is on.
  public func requiresUnlock(enabled: Bool, backgroundedAt: Date?, now: Date) -> Bool {
    guard enabled else {
      return false
    }
    guard let backgroundedAt else {
      return true
    }

    return now.timeIntervalSince(backgroundedAt) >= gracePeriod
  }
}
