import BotgeKit
import SwiftUI

/// Lists the servers the user shares with Botge and remembers the one they pick.
struct ServerPickerView: View {
  /// Loads the servers.
  @Environment(AppModel.self) private var model
  /// The server the feature tabs show, saved across launches.
  @AppStorage(PreferenceKey.defaultGuildID) private var selectedGuildID = ""

  var body: some View {
    Group {
      if !model.guilds.isEmpty {
        List(model.guilds) { guild in
          Button {
            selectedGuildID = guild.id
          } label: {
            ServerRow(guild: guild, isSelected: guild.id == selectedGuildID)
          }
          .tint(.primary)
          .accessibilityIdentifier("server.\(guild.id)")
        }
      } else if model.hasLoadedGuilds {
        ContentUnavailableView(
          "No Shared Servers",
          systemImage: "person.2.slash",
          description: Text("Botge isn't in any server you belong to.")
        )
      } else if let failure = model.guildsFailure {
        ContentUnavailableView {
          Label("Servers Unavailable", systemImage: "wifi.exclamationmark")
        } description: {
          Text(failure.message)
        } actions: {
          Button("Try Again") {
            Task { await model.loadGuilds() }
          }
          .accessibilityIdentifier("servers.retry")
        }
      } else {
        ProgressView("Loading Servers")
      }
    }
    .navigationTitle("Servers")
    .refreshable { await model.loadGuilds() }
  }
}
