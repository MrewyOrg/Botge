import AppIntents
import BotgeKit
import SwiftUI

/// The Botge iOS app: Discord login, then the Emotes, Guess, Server and Settings tabs.
@main
struct BotgeApp: App {
  /// App-wide state shared through the environment and with App Intents.
  @State private var model: AppModel
  /// The appearance chosen in Settings.
  @AppStorage(PreferenceKey.appearance) private var appearance: AppearancePreference = .system

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .preferredColorScheme(appearance.colorScheme)
    }
  }

  /// Creates the app model and shares it with App Intents.
  init() {
    let live = AppModel.makeLive()
    _model = State(initialValue: live)
    AppDependencyManager.shared.add(dependency: live)
  }
}
