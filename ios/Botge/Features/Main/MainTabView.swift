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
  /// The saved server choice.
  @AppStorage(PreferenceKey.defaultGuildID) private var selectedGuildID = ""
  /// Whether the app is in the foreground.
  @Environment(\.scenePhase) private var scenePhase
  /// The selected server's Guess room, kept here so a match survives switching tabs.
  @State private var guess: GuessModel?

  var body: some View {
    @Bindable var model = model
    TabView(selection: $model.selectedTab) {
      Tab("Emotes", systemImage: "face.smiling", value: .emotes) {
        ServerScope { guild in
          EmotesView(guild: guild, app: model)
            .id(guild.id)
        }
        .overlay {
          if model.isPlayingGuess {
            GuessLockView()
          }
        }
      }
      Tab("Guess", systemImage: "gamecontroller", value: .guess) {
        ServerScope { guild in
          if let guess, guess.guild.id == guild.id {
            GuessView(model: guess)
          }
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
    .onChange(of: model.guilds.first { $0.id == selectedGuildID }?.id, initial: true) {
      guess = model.guilds
        .first { $0.id == selectedGuildID }
        .map { GuessModel(guild: $0, app: model) }
    }
    .task {
      await GuessActivityController.endLeftovers()
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        guess?.resume()
      }
    }
    .task(id: guess?.taskID) {
      await guess?.play()
    }
  }
}
