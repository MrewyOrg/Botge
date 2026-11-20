/// `UserDefaults` keys for non-secret preferences. Tokens never go here.
enum PreferenceKey {
  /// The ``AppearancePreference`` raw value.
  static let appearance = "appearance"
  /// Whether App Lock asks for Face ID or the passcode.
  static let appLock = "appLock"
  /// The ``AppLockTimeout`` raw value: how long Botge may stay in the background unlocked.
  static let appLockTimeout = "appLockTimeout"
  /// The Discord server opened on launch, if any.
  static let defaultGuildID = "defaultGuildID"
}
