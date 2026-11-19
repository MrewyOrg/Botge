import AppIntents

/// The shortcuts Botge offers in Siri, Spotlight, the Shortcuts app and the Action button.
struct BotgeShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SearchEmotesIntent(),
      phrases: [
        "Search emotes in \(.applicationName)",
        "Find an emote in \(.applicationName)"
      ],
      shortTitle: "Search Emotes",
      systemImageName: "magnifyingglass"
    )
    AppShortcut(
      intent: OpenGuessIntent(),
      phrases: [
        "Play Guess in \(.applicationName)",
        "Open \(.applicationName) Guess"
      ],
      shortTitle: "Play Guess",
      systemImageName: "gamecontroller"
    )
  }

  static let shortcutTileColor: ShortcutTileColor = .purple
}
