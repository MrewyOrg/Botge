/// How the device owner unlocks, as the system names and draws it.
struct UnlockMethod: Equatable {
  /// The localized name, such as Face ID or Passcode.
  let name: String
  /// The SF Symbol name, such as `faceid`.
  let symbol: String
}
