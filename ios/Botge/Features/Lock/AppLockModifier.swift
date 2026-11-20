import BotgeKit
import SwiftUI

/// Covers the app with a lock screen until Face ID or the device passcode succeeds.
///
/// While App Lock is on, the app is also blurred whenever it is not active, so the app switcher
/// snapshot never shows readable content. Authentication happens entirely on the device; Botge
/// never receives biometric data. ``AppLockState`` decides when to lock and ask.
struct AppLockModifier: ViewModifier {
  /// How strongly the app blurs while it is not active.
  private static let privacyBlur: CGFloat = 30

  /// Whether App Lock is on.
  @AppStorage(PreferenceKey.appLock) private var isEnabled = false
  /// How long Botge may stay in the background before asking again.
  @AppStorage(PreferenceKey.appLockTimeout) private var timeout: AppLockTimeout = .immediately
  /// Foreground and background transitions.
  @Environment(\.scenePhase) private var scenePhase
  /// Checks for the device owner.
  @Environment(\.ownerAuthentication) private var owner
  /// When the app is locked and when it asks to unlock.
  @State private var lock: AppLockState = .init(policy: AppLockPolicy())

  func body(content: Content) -> some View {
    let isHidden = isEnabled && scenePhase != .active
    content
      .blur(radius: isHidden ? Self.privacyBlur : 0, opaque: true)
      .accessibilityHidden(isHidden)
      .overlay {
        if isEnabled, lock.isLocked {
          AppLockScreen(symbol: owner.lockSymbol, isAuthenticating: lock.isAuthenticating) {
            Task { await lock.unlock(enabled: isEnabled, owner: owner) }
          }
          .transition(.opacity)
        }
      }
      .animation(.default, value: lock.isLocked)
      .onChange(of: timeout, initial: true) { _, timeout in
        lock.policy = AppLockPolicy(gracePeriod: timeout.interval)
      }
      .onChange(of: isEnabled) { _, enabled in
        lock.enabledChanged(to: enabled)
      }
      .onChange(of: scenePhase, initial: true) { _, phase in
        switch phase {
        case .active:
          if lock.becameActive(enabled: isEnabled, now: .now) {
            Task { await lock.unlock(enabled: isEnabled, owner: owner) }
          }

        case .background:
          lock.enteredBackground(at: .now)

        default:
          break
        }
      }
  }
}

extension View {
  /// Requires Face ID or the passcode when App Lock is on in Settings.
  ///
  /// - Returns: The view, covered by the lock screen while locked.
  func appLock() -> some View {
    modifier(AppLockModifier())
  }
}
