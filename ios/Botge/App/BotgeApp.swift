import BotgeKit
import SwiftUI

/// The Botge iOS app: Discord login, then the Emotes, Guess, Server and Settings tabs.
@main
struct BotgeApp: App {
  /// App-wide state shared through the environment.
  @State private var model: AppModel = .live()
  /// The appearance chosen in Settings.
  @AppStorage(PreferenceKey.appearance) private var appearance: AppearancePreference = .system

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .preferredColorScheme(appearance.colorScheme)
    }
  }
}
