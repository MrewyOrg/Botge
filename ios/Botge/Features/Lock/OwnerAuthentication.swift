import LocalAuthentication
import SwiftUI

/// Checks that the device owner is present with Face ID, Touch ID, Optic ID or the passcode.
///
/// Views read it from the environment, so tests can stand in for the system prompt.
struct OwnerAuthentication {
  /// The device's own biometrics and passcode.
  static let device: Self = .init(
    biometry: {
      let context = LAContext()
      _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
      return context.biometryType
    },
    isAvailable: {
      LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    },
    authenticate: { reason in
      await (try? LAContext().evaluatePolicy(
        .deviceOwnerAuthentication,
        localizedReason: reason
      )) ?? false
    }
  )

  /// The biometric method the device offers, or `.none`.
  let biometry: @Sendable () -> LABiometryType
  /// Whether the device has a passcode, so authentication can succeed.
  let isAvailable: @Sendable () -> Bool
  /// Shows the system prompt with a reason and returns whether the owner authenticated.
  let authenticate: @Sendable (String) async -> Bool

  /// The name of the device's lock method for the App Lock setting.
  var lockTitle: LocalizedStringResource {
    switch biometry() {
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
}

extension EnvironmentValues {
  /// How views check for the device owner; the device's own prompt by default.
  @Entry var ownerAuthentication: OwnerAuthentication = .device
}
