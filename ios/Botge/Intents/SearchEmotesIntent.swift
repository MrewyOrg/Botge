import AppIntents

/// Opens Botge and searches the selected server's emotes, from Siri, Spotlight or Shortcuts.
struct SearchEmotesIntent: AppIntent {
  static let title: LocalizedStringResource = "Search Botge Emotes"
  // The App Intents runtime reads the description; nothing in the app does.
  // swiftlint:disable:next unused_declaration
  static let description: IntentDescription = .init(
    "Opens Botge and searches the emotes of the server you picked in the app."
  )
  static let supportedModes: IntentModes = .foreground

  /// The search text.
  @Parameter(title: "Search", requestValueDialog: "Which emote are you looking for?")
  var search: String

  /// The app model that switches tabs and applies the search.
  @Dependency var model: AppModel

  /// Opens the Emotes tab with the search applied.
  ///
  /// - Returns: An empty result; the app shows the matches.
  @MainActor
  func perform() -> some IntentResult {
    model.search(search)
    return .result()
  }
}
