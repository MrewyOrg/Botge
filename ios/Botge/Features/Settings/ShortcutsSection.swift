import AppIntents
import SwiftUI

/// Shows Botge's App Shortcuts, so people learn they can use Siri and the Action button.
struct ShortcutsSection: View {
  var body: some View {
    Section {
      ShortcutsLink()
        .shortcutsLinkStyle(.automaticOutline)
        .frame(maxWidth: .infinity)
        .listRowBackground(Color.clear)
    } header: {
      Text("Siri & Shortcuts")
    } footer: {
      Text(
        "Say “Search emotes in Botge” or “Play Guess in Botge”, or add them to the Action button."
      )
    }
  }
}
