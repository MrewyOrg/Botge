import LocalAuthentication
import SwiftUI

/// Checks that the device owner is present with Face ID, Touch ID, Optic ID or the passcode.
///
/// Views read it from the environment, so tests can stand in for the system prompt.
struct OwnerAuthentication {
  /// The device's own biometrics and passcode, through `LARight` and `LAEnvironment`.
  static let device: Self = .init(
    method: {
      // Biometry when it is enrolled, else the passcode; a mechanism is usable once set up.
      let state = LAEnvironment.currentUser.state
      let mechanisms: [LAEnvironment.Mechanism?] = [state.biometry, state.userPassword]
      guard let mechanism = mechanisms.compactMap(\.self).first(where: \.isUsable) else {
        return nil
      }

      return UnlockMethod(name: mechanism.localizedName, symbol: mechanism.iconSystemName)
    },
    isAvailable: {
      LAEnvironment.currentUser.state.userPassword?.isSet == true
    },
    authenticate: { reason in
      // The default requirement accepts biometry and falls back to the passcode.
      await (try? LARight().authorize(localizedReason: reason)) != nil
    }
  )

  /// The device's preferred unlock method, or `nil` when it has none.
  let method: @Sendable () -> UnlockMethod?
  /// Whether the device has a passcode, so authentication can succeed.
  let isAvailable: @Sendable () -> Bool
  /// Shows the system prompt with a reason and returns whether the owner authenticated.
  let authenticate: @Sendable (String) async -> Bool

  /// The App Lock setting's name: the system's name for the unlock method, such as Face ID.
  var lockTitle: String {
    method()?.name ?? String(localized: "App Lock")
  }

  /// The unlock method's SF Symbol, such as `faceid`.
  var lockSymbol: String {
    method()?.symbol ?? "lock"
  }
}

extension EnvironmentValues {
  /// How views check for the device owner; the device's own prompt by default.
  @Entry var ownerAuthentication: OwnerAuthentication = .device
}
