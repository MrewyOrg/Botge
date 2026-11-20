import AppIntents

/// Opens Botge on the Guess tab, ready to create or join a room.
struct OpenGuessIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Botge Guess"
  // The App Intents runtime reads the description; nothing in the app does.
  // swiftlint:disable:next unused_declaration
  static let description: IntentDescription = .init("Opens the emote guessing game in Botge.")
  static let supportedModes: IntentModes = .foreground

  /// The app model that switches tabs.
  @Dependency var model: AppModel

  /// Selects the Guess tab.
  ///
  /// - Returns: An empty result.
  @MainActor
  func perform() -> some IntentResult {
    model.selectedTab = .guess
    return .result()
  }
}
