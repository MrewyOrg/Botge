import BotgeKit
import SwiftUI

/// The emote grid, or the loading, failure, or empty state for the current source.
struct EmotesContent: View {
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    if let failure = currentFailure, model.visibleEmotes.isEmpty {
      ContentUnavailableView {
        Label("Emotes Unavailable", systemImage: "wifi.exclamationmark")
      } description: {
        Text(failure.message)
      } actions: {
        Button("Try Again") {
          Task { await retry() }
        }
      }
    } else if isLoading, model.visibleEmotes.isEmpty {
      ProgressView("Loading Emotes")
    } else if model.visibleEmotes.isEmpty {
      ContentUnavailableView.search(text: model.filter.query)
    } else {
      EmoteGrid(model: model)
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

  /// Reloads the current source.
  private func retry() async {
    if model.source == .server {
      await model.load()
    } else {
      await model.reloadDiscovery()
    }
  }
}
