import SwiftUI

/// The App Lock toggle, named after the device's biometric method.
///
/// Turning App Lock on or off asks for Face ID or the passcode first, so the setting only changes
/// for the device owner and is never turned on where it cannot unlock.
struct SecuritySection: View {
  /// Whether App Lock is on.
  @AppStorage(PreferenceKey.appLock) private var appLock = false
  /// Checks for the device owner.
  @Environment(\.ownerAuthentication) private var owner
  /// Whether the authentication prompt is showing.
  @State private var isAuthenticating = false
  /// Why the last change failed, if it did.
  @State private var failure: String?

  var body: some View {
    Section {
      Toggle(isOn: lockBinding) {
        Label(owner.lockTitle, systemImage: "lock")
      }
      .disabled(isAuthenticating)
      .accessibilityIdentifier("settings.appLock")
    } header: {
      Text("Security")
    } footer: {
      if let failure {
        Text(failure)
      } else {
        Text("Ask for \(owner.lockTitle) or your passcode when opening Botge.")
      }
    }
  }

  /// Changes App Lock only after the device owner authenticates.
  private var lockBinding: Binding<Bool> {
    Binding {
      appLock
    } set: { enabled in
      Task { await change(to: enabled) }
    }
  }

  /// Authenticates, then turns App Lock on or off.
  ///
  /// - Parameter enabled: The requested state.
  private func change(to enabled: Bool) async {
    guard enabled != appLock, !isAuthenticating else {
      return
    }

    isAuthenticating = true
    defer { isAuthenticating = false }
    guard owner.isAvailable() else {
      failure = String(localized: "Set a passcode in the Settings app to use App Lock.")
      return
    }

    let reason = enabled
      ? String(localized: "Turn on App Lock")
      : String(localized: "Turn off App Lock")
    if await owner.authenticate(reason) {
      failure = nil
      appLock = enabled
    }
  }
}
