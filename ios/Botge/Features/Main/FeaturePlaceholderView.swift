import BotgeKit
import SwiftUI

/// Stands in for a feature tab until its screens land.
struct FeaturePlaceholderView: View {
  /// The tab's title.
  let title: LocalizedStringResource
  /// The tab's symbol.
  let systemImage: String
  /// The server the tab shows.
  let guild: SharedGuild

  var body: some View {
    ContentUnavailableView(
      "Coming Soon",
      systemImage: systemImage,
      description: Text("This part of Botge for \(guild.name) arrives in a later build.")
    )
    .navigationTitle(Text(title))
  }
}
