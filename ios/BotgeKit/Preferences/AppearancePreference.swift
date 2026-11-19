/// The colour scheme chosen in Settings.
public enum AppearancePreference: String, Sendable {
  /// Always dark.
  case dark
  /// Always light.
  case light
  /// Follow the system's light or dark setting.
  case system

  /// Options in the order Settings shows them.
  public static let displayOrder: [Self] = [.system, .light, .dark]
}
