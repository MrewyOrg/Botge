import BotgeKit
import SwiftUI

/// The main menu after login: one tab per Botge feature.
struct MainTabView: View {
  /// The tabs, also used by App Intents to open a specific one.
  enum Section: String, Hashable {
    case emotes
    case guess
    case server
    case settings
  }

  /// Provides the API for the feature tabs.
  @Environment(AppModel.self) private var model
  /// The selected tab.
  @State private var selection: Section = .emotes

  var body: some View {
    TabView(selection: $selection) {
      Tab("Emotes", systemImage: "face.smiling", value: .emotes) {
        ServerScope { guild in
          EmotesView(guild: guild, app: model)
            .id(guild.id)
        }
      }
      Tab("Guess", systemImage: "gamecontroller", value: .guess) {
        ServerScope { guild in
          FeaturePlaceholderView(title: "Guess", systemImage: "gamecontroller", guild: guild)
        }
      }
      Tab("Server", systemImage: "server.rack", value: .server) {
        ServerScope { guild in
          ServerView(guild: guild, app: model)
            .id(guild.id)
        }
      }
      Tab("Settings", systemImage: "gearshape", value: .settings) {
        SettingsView()
      }
    }
    .tabBarMinimizeBehavior(.onScrollDown)
  }
}
