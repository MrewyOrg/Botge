import BotgeKit
import SwiftUI

/// A scrolling grid of the visible emotes that previews or selects them and pages discovery.
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
            if model.isSelecting {
              model.toggleSelection(emote)
            } else {
              model.sheet = .preview(emote)
            }
          } label: {
            EmoteTile(emote: emote, isSelected: model.selection.contains(emote.id))
          }
          .buttonStyle(.plain)
          .contextMenu {
            EmoteActions(emote: emote, model: model)
          }
          .onAppear {
            if emote.id == model.visibleEmotes.last?.id, model.source != .server {
              Task { await model.loadMoreDiscovery() }
            }
          }
        }
      }
      .padding()
      if model.discovery.isLoading, model.source != .server {
        ProgressView()
          .padding()
      }
    }
    .accessibilityIdentifier("emotes.grid")
  }
}
