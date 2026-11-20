import BotgeKit
import SwiftUI

/// The emote grid, or the loading, failure, or empty state for one source.
struct EmotesContent: View {
  /// The server's catalog state.
  let model: EmotesModel
  /// The source this page shows.
  let source: EmotesSource

  var body: some View {
    let emotes = model.visibleEmotes(for: source)
    if let failure = currentFailure, emotes.isEmpty {
      ContentUnavailableView {
        Label("Emotes Unavailable", systemImage: "wifi.exclamationmark")
      } description: {
        Text(failure.message)
      } actions: {
        Button("Try Again") {
          Task { await model.refresh(source) }
        }
      }
    } else if isLoading, emotes.isEmpty {
      ProgressView("Loading Emotes")
    } else if emotes.isEmpty {
      emptyState
    } else {
      EmoteGrid(model: model, emotes: emotes, source: source)
        // Dense grids cap text growth, like Photos, so several emotes still fit across.
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .id(source)
    }
  }

  /// Explains an empty grid: no search results, no filter matches, or no emotes at all.
  @ViewBuilder private var emptyState: some View {
    let filter = model.filter(for: source)
    let query = filter.query.trimmingCharacters(in: .whitespaces)
    if !query.isEmpty {
      ContentUnavailableView.search(text: query)
    } else if filter.activeCount > 0 {
      ContentUnavailableView {
        Label("No Matches", systemImage: "line.3.horizontal.decrease.circle")
      } description: {
        Text("No emotes match the filters.")
      } actions: {
        Button("Clear Filters") {
          model.filter = EmoteFilter()
        }
      }
    } else {
      ContentUnavailableView(
        "No Emotes",
        systemImage: "face.dashed",
        description: source == .server
          ? Text("This server has no emotes yet.")
          : Text("7TV returned no emotes.")
      )
    }
  }

  /// The failure for this source.
  private var currentFailure: APIError? {
    if source == .server {
      model.failure
    } else {
      model.discovery(for: source).failure
    }
  }

  /// Whether this source is still loading its first results.
  private var isLoading: Bool {
    if source == .server {
      model.catalog == nil
    } else {
      model.discovery(for: source).page == 0
    }
  }
}
