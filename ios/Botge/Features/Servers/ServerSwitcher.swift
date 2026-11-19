import BotgeKit
import SwiftUI

/// A toolbar menu that switches the server every feature tab shows.
///
/// Switching asks first while a Guess match is running or the Server tab has unsaved edits,
/// since both are lost.
struct ServerSwitcher: View {
  /// Supplies the loaded servers and what switching would interrupt.
  @Environment(AppModel.self) private var model
  /// The saved server choice.
  @AppStorage(PreferenceKey.defaultGuildID) private var selectedGuildID = ""
  /// A server waiting for the user to confirm the switch.
  @State private var pendingGuildID: String?

  /// The server shown now.
  let selection: SharedGuild

  var body: some View {
    Menu {
      Picker("Server", selection: choice) {
        ForEach(model.guilds) { guild in
          Text(guild.name).tag(guild.id)
        }
      }
    } label: {
      Label(selection.name, systemImage: "server.rack")
    }
    .accessibilityIdentifier("servers.switch")
    .confirmationDialog(
      "Switch servers?",
      isPresented: Binding { pendingGuildID != nil } set: { isShown in
        if !isShown {
          pendingGuildID = nil
        }
      }
    ) {
      Button("Switch Servers", role: .destructive) {
        if let pendingGuildID {
          selectedGuildID = pendingGuildID
        }
      }
    } message: {
      Text(interruption)
    }
  }

  /// The selection, which asks before switching when that would lose something.
  private var choice: Binding<String> {
    Binding {
      selectedGuildID
    } set: { id in
      guard id != selectedGuildID else {
        return
      }

      if model.isPlayingGuess || model.hasUnsavedServerChanges {
        pendingGuildID = id
      } else {
        selectedGuildID = id
      }
    }
  }

  /// What switching would lose.
  private var interruption: String {
    if model.isPlayingGuess {
      String(localized: "You leave the Guess match in \(selection.name).")
    } else {
      String(localized: "Your unsaved changes to \(selection.name) are discarded.")
    }
  }
}
