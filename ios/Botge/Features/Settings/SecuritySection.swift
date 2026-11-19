import LocalAuthentication
import SwiftUI

/// The App Lock toggle, named after the device's biometric method.
///
/// Turning App Lock on or off asks for Face ID or the passcode first, so the setting only changes
/// for the device owner and is never turned on where it cannot unlock.
struct SecuritySection: View {
  /// The device's biometric method, or a generic name without one.
  private static var lockTitle: LocalizedStringResource {
    let context = LAContext()
    _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    return switch context.biometryType {
    case .faceID:
      "Face ID"

    case .touchID:
      "Touch ID"

    case .opticID:
      "Optic ID"

    default:
      "App Lock"
    }
  }

  /// Whether App Lock is on.
  @AppStorage(PreferenceKey.appLock) private var appLock = false
  /// Whether the authentication prompt is showing.
  @State private var isAuthenticating = false
  /// Why the last change failed, if it did.
  @State private var failure: String?

  var body: some View {
    Section {
      Toggle(isOn: lockBinding) {
        Label(Self.lockTitle, systemImage: "lock")
      }
      .disabled(isAuthenticating)
      .accessibilityIdentifier("settings.appLock")
    } header: {
      Text("Security")
    } footer: {
      if let failure {
        Text(failure)
      } else {
        Text("Ask for \(Self.lockTitle) or your passcode when opening Botge.")
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
    let context = LAContext()
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
      failure = String(localized: "Set a passcode in the Settings app to use App Lock.")
      return
    }

    let reason = enabled
      ? String(localized: "Turn on App Lock")
      : String(localized: "Turn off App Lock")
    let approved = await (try? context.evaluatePolicy(
      .deviceOwnerAuthentication,
      localizedReason: reason
    )) ?? false
    if approved {
      failure = nil
      appLock = enabled
    }
  }
}
