public import Foundation

/// How long Botge may stay in the background before App Lock asks again.
public enum AppLockTimeout: Int, CaseIterable, Sendable {
  /// Ask after fifteen minutes in the background.
  case fifteenMinutes = 900
  /// Ask every time Botge returns.
  case immediately = 0
  /// Ask after an hour in the background.
  case oneHour = 3_600
  /// Ask after one minute in the background.
  case oneMinute = 60

  /// The grace period in seconds.
  public var interval: TimeInterval {
    TimeInterval(rawValue)
  }
}
