import BotgeKit
import LocalAuthentication
import SwiftUI

/// Covers the app with a lock screen until Face ID or the device passcode succeeds.
///
/// While App Lock is on, the app is also covered whenever it is not active, so the app switcher
/// snapshot never shows its content. Authentication happens entirely on the device; Botge never
/// receives biometric data.
private struct AppLockModifier: ViewModifier {
  /// When to ask again after backgrounding.
  private static let policy: AppLockPolicy = .init()

  /// Whether App Lock is on.
  @AppStorage(PreferenceKey.appLock) private var isEnabled = false
  /// Foreground and background transitions.
  @Environment(\.scenePhase) private var scenePhase
  /// Whether the lock screen covers the app.
  @State private var isLocked = true
  /// When the app last went to the background, for the grace period.
  @State private var backgroundedAt: Date?
  /// Whether the Face ID or passcode prompt is showing.
  @State private var isAuthenticating = false

  func body(content: Content) -> some View {
    content
      .overlay {
        if isEnabled, isLocked {
          AppLockScreen(isAuthenticating: isAuthenticating) {
            Task { await unlock() }
          }
          .transition(.opacity)
        } else if isEnabled, scenePhase != .active {
          Rectangle()
            .fill(.background)
            .ignoresSafeArea()
            .accessibilityHidden(true)
        }
      }
      .onChange(of: isEnabled) { _, enabled in
        // Settings just authenticated the owner, so turning the lock on does not lock the app.
        if enabled {
          isLocked = false
        }
      }
      .onChange(of: scenePhase, initial: true) { _, phase in
        switch phase {
        case .active:
          if Self.policy.requiresUnlock(
            enabled: isEnabled,
            backgroundedAt: backgroundedAt,
            now: .now
          ), isLocked || backgroundedAt != nil {
            isLocked = true
            Task { await unlock() }
          }
          backgroundedAt = nil

        case .background:
          backgroundedAt = .now

        default:
          break
        }
      }
  }

  /// Prompts for Face ID or the passcode and unlocks on success.
  private func unlock() async {
    guard isEnabled, !isAuthenticating else {
      isLocked = false
      return
    }

    isAuthenticating = true
    defer { isAuthenticating = false }
    let context = LAContext()
    let unlocked = await (try? context.evaluatePolicy(
      .deviceOwnerAuthentication,
      localizedReason: String(localized: "Unlock Botge")
    )) ?? false
    withAnimation { isLocked = !unlocked }
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
