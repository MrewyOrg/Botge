import BotgeKit
import SwiftUI

/// The catalog grid, or the loading, failure, or empty state.
struct EmotesContent: View {
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    if model.catalog == nil, let failure = model.failure {
      ContentUnavailableView {
        Label("Emotes Unavailable", systemImage: "wifi.exclamationmark")
      } description: {
        Text(failure.message)
      } actions: {
        Button("Try Again") {
          Task { await model.load() }
        }
      }
    } else if model.catalog == nil {
      ProgressView("Loading Emotes")
    } else if model.visibleEmotes.isEmpty {
      ContentUnavailableView.search(text: model.filter.query)
    } else {
      EmoteGrid(model: model)
    }
  }
}
