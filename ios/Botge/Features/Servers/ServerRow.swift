import BotgeKit
import SwiftUI

/// One server in the picker: icon, name, and whether the user administers it.
struct ServerRow: View {
  /// Side length of the server icon.
  private static let iconSize: CGFloat = 40

  /// The server shown.
  let guild: SharedGuild
  /// Whether this is the server the feature tabs show.
  let isSelected: Bool

  var body: some View {
    HStack {
      AsyncImage(url: guild.icon) { image in
        image.resizable()
      } placeholder: {
        Image(systemName: "person.3.fill")
          .foregroundStyle(.secondary)
      }
      .frame(width: Self.iconSize, height: Self.iconSize)
      .clipShape(.circle)
      .accessibilityHidden(true)
      VStack(alignment: .leading) {
        Text(guild.name)
          .foregroundStyle(.primary)
        if guild.isAdministrator {
          Text("Administrator")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      Spacer()
      if isSelected {
        Image(systemName: "checkmark")
          .foregroundStyle(.tint)
          .accessibilityLabel("Selected")
      }
    }
  }
}
