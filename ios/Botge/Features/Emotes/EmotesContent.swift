import BotgeKit
import SwiftUI

/// The emote grid, or the loading, failure, or empty state for the current source.
struct EmotesContent: View {
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    let emotes = model.visibleEmotes
    if let failure = currentFailure, emotes.isEmpty {
      ContentUnavailableView {
        Label("Emotes Unavailable", systemImage: "wifi.exclamationmark")
      } description: {
        Text(failure.message)
      } actions: {
        Button("Try Again") {
          Task { await model.refresh() }
        }
      }
    } else if isLoading, emotes.isEmpty {
      ProgressView("Loading Emotes")
    } else if emotes.isEmpty {
      emptyState
    } else {
      EmoteGrid(model: model, emotes: emotes)
        .id(model.source)
    }
  }

  /// Explains an empty grid: no search results, no filter matches, or no emotes at all.
  @ViewBuilder private var emptyState: some View {
    let query = model.filter.query.trimmingCharacters(in: .whitespaces)
    if !query.isEmpty {
      ContentUnavailableView.search(text: query)
    } else if model.filter.activeCount > 0 {
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
        description: model.source == .server
          ? Text("This server has no emotes yet.")
          : Text("7TV returned no emotes.")
      )
    }
  }

  /// The failure for the current source.
  private var currentFailure: APIError? {
    if model.source == .server {
      model.failure
    } else {
      model.discovery.failure
    }
  }

  /// Whether the current source is still loading its first results.
  private var isLoading: Bool {
    if model.source == .server {
      model.catalog == nil
    } else {
      model.discovery.page == 0
    }
  }
}
