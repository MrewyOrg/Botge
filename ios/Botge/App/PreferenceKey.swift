/// `UserDefaults` keys for non-secret preferences. Tokens never go here.
enum PreferenceKey {
  /// The ``AppearancePreference`` raw value.
  static let appearance = "appearance"
  /// Whether App Lock asks for Face ID or the passcode.
  static let appLock = "appLock"
  /// Whether haptic feedback plays.
  static let haptics = "haptics"
  /// The ``EmotePlayback`` raw value.
  static let emotePlayback = "emotePlayback"
  /// The Discord server opened on launch, if any.
  static let defaultGuildID = "defaultGuildID"
}
