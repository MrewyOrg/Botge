import BotgeKit
import SwiftUI

/// One server in the picker: icon, name, and whether the user administers it.
struct ServerRow: View {
  /// How far the initials may shrink to fit the icon.
  private static let initialsScale = 0.5

  /// Side length of the server icon, growing with the text size.
  @ScaledMetric private var iconSize: CGFloat = 40

  /// The text size; accessibility sizes stack the icon above the name.
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  /// The server shown.
  let guild: SharedGuild
  /// Whether this is the server the feature tabs show.
  let isSelected: Bool

  var body: some View {
    let layout = dynamicTypeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading))
      : AnyLayout(HStackLayout())
    layout {
      AsyncImage(url: guild.icon) { image in
        image.resizable()
      } placeholder: {
        Text(guild.initials)
          .font(.caption.weight(.semibold))
          .minimumScaleFactor(Self.initialsScale)
          .lineLimit(1)
          .padding(Metrics.tightSpacing)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(.fill.secondary)
      }
      .frame(width: iconSize, height: iconSize)
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
          .foregroundStyle(Color.accentColor)
          .accessibilityLabel("Selected")
      }
    }
  }

  /// Creates a row.
  ///
  /// - Parameters:
  ///   - guild: The server shown.
  ///   - isSelected: Whether this is the server the feature tabs show.
  init(guild: SharedGuild, isSelected: Bool) {
    self.guild = guild
    self.isSelected = isSelected
  }
}
