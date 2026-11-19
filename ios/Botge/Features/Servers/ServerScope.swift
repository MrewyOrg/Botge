import BotgeKit
import SwiftUI

/// Shows `content` for the selected server, or the server picker until one is chosen.
///
/// The toolbar offers a menu to switch servers. A saved server the user no longer shares with
/// Botge counts as unselected.
struct ServerScope<Content: View>: View {
  /// Supplies the loaded servers.
  @Environment(AppModel.self) private var model
  /// The saved server choice.
  @AppStorage(PreferenceKey.defaultGuildID) private var selectedGuildID = ""

  /// Builds the feature for the selected server.
  @ViewBuilder let content: (SharedGuild) -> Content

  var body: some View {
    NavigationStack {
      if let guild = model.guilds.first(where: { $0.id == selectedGuildID }) {
        content(guild)
          .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
              ServerSwitcher(selection: guild)
            }
          }
      } else {
        ServerPickerView()
      }
    }
    .task {
      if !model.hasLoadedGuilds {
        await model.loadGuilds()
      }
    }
  }
}
