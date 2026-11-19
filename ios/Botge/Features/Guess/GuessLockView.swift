import SwiftUI

/// Covers the Emotes tab during a Guess match, so nobody can look up the answer.
struct GuessLockView: View {
  var body: some View {
    ContentUnavailableView(
      "Emotes Hidden",
      systemImage: "eye.slash",
      description: Text("The emote list comes back when the Guess match ends.")
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.background)
    .accessibilityIdentifier("emotes.locked")
  }
}
