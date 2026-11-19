import BotgeKit
import SwiftUI

/// A scrolling grid of emotes that previews or selects them and pages discovery.
///
/// Each source gets its own grid, which reopens at the emote that was at its top.
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
          EmoteCell(emote: emote, model: model)
            .onAppear {
              if emote.id == lastID, source != .server {
                Task { await model.loadMoreDiscovery() }
              }
            }
        }
      }
      .scrollTargetLayout()
      .padding()
      if model.discovery.isLoading, source != .server {
        ProgressView()
          .padding()
      }
    }
    .scrollPosition(id: anchor, anchor: .top)
    .refreshable { await model.refresh() }
    .accessibilityIdentifier("emotes.grid")
  }

  /// The emote at the top of the grid, saved per source.
  private var anchor: Binding<String?> {
    Binding { [source] in
      model.scrollAnchor(for: source)
    } set: { [source] id in
      model.setScrollAnchor(id, for: source)
    }
  }

  /// Creates the grid for the model's current source.
  ///
  /// - Parameters:
  ///   - model: The server's catalog state.
  ///   - emotes: The emotes to show.
  init(model: EmotesModel, emotes: [CatalogEmote]) {
    self.model = model
    self.emotes = emotes
    source = model.source
  }
}
