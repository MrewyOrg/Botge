import BotgeKit
import SwiftUI

/// A scrolling grid of emotes that previews or selects them and pages discovery.
///
/// Each source gets its own grid, kept alive as a page, so it keeps its scroll position.
struct EmoteGrid: View {
  /// Smallest tile width, growing with the text size; columns adapt to the screen.
  @ScaledMetric private var tileWidth: CGFloat = 76
  /// The server's catalog state.
  let model: EmotesModel
  /// The emotes shown, computed once per update.
  let emotes: [CatalogEmote]
  /// The source this grid shows, fixed for its lifetime.
  private let source: EmotesSource

  var body: some View {
    let lastID = emotes.last?.id
    ScrollView {
      LazyVGrid(
        columns: [GridItem(.adaptive(minimum: tileWidth))],
        spacing: Metrics.compactSpacing
      ) {
        ForEach(emotes) { emote in
          EmoteCell(emote: emote, model: model, source: source)
            .onAppear {
              if emote.id == lastID, source != .server {
                Task { await model.loadMoreDiscovery(for: source) }
              }
            }
        }
      }
      .padding()
      if model.discovery(for: source).isLoading, source != .server {
        ProgressView()
          .padding()
      }
    }
    // Rows slide under the glass bars instead of stopping at the pager's edge.
    .scrollClipDisabled()
    .refreshable { await model.refresh(source) }
    .accessibilityIdentifier("emotes.grid")
  }

  /// Creates the grid for one source.
  ///
  /// - Parameters:
  ///   - model: The server's catalog state.
  ///   - emotes: The emotes to show.
  ///   - source: The source the emotes come from.
  init(model: EmotesModel, emotes: [CatalogEmote], source: EmotesSource) {
    self.model = model
    self.emotes = emotes
    self.source = source
  }
}
