import BotgeKit
import SwiftUI

/// A toolbar menu that switches the server every feature tab shows.
struct ServerSwitcher: View {
  /// Supplies the loaded servers.
  @Environment(AppModel.self) private var model
  /// The saved server choice.
  @AppStorage(PreferenceKey.defaultGuildID) private var selectedGuildID = ""

  /// The server shown now.
  let selection: SharedGuild

  var body: some View {
    Menu {
      Picker("Server", selection: $selectedGuildID) {
        ForEach(model.guilds) { guild in
          Text(guild.name).tag(guild.id)
        }
      }
    } label: {
      Label(selection.name, systemImage: "server.rack")
    }
    .accessibilityIdentifier("servers.switch")
  }
}
