import BotgeKit
import SwiftUI

/// A scrolling grid of the emotes that pass the filter.
struct EmoteGrid: View {
  /// Smallest tile width; columns adapt to the screen.
  private static let tileWidth: CGFloat = 76

  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    ScrollView {
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: Self.tileWidth))],
        spacing: Metrics.compactSpacing
      ) {
        ForEach(model.visibleEmotes) { emote in
          Button {
            model.sheet = .preview(emote)
          } label: {
            EmoteTile(emote: emote)
          }
          .buttonStyle(.plain)
          .contextMenu {
            EmoteActions(emote: emote, model: model)
          }
        }
      }
      .padding()
    }
    .accessibilityIdentifier("emotes.grid")
  }
}
