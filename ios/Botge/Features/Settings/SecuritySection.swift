import LocalAuthentication
import SwiftUI

/// The App Lock toggle, named after the device's biometric method.
struct SecuritySection: View {
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

  var body: some View {
    Section {
      Toggle(isOn: $appLock) {
        Label(Self.lockTitle, systemImage: "lock")
      }
      .accessibilityIdentifier("settings.appLock")
    } header: {
      Text("Security")
    } footer: {
      Text("Ask for \(Self.lockTitle) or your passcode when opening Botge.")
    }
  }
}
