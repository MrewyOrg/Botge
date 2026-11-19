import BotgeKit
import SwiftUI

/// Filters, the composer and selection mode in the Emotes navigation bar.
struct EmotesToolbar: ToolbarContent {
  /// The server's catalog state.
  let model: EmotesModel

  var body: some ToolbarContent {
    @Bindable var model = model
    ToolbarItem(placement: .topBarLeading) {
      EmoteFilterMenu(filter: $model.filter)
    }
    ToolbarItem(placement: .topBarLeading) {
      Button {
        model.sheet = .composer
      } label: {
        Label("Compose (\(model.composition.layers.count))", systemImage: "square.stack.3d.up")
      }
      .accessibilityIdentifier("emotes.compose")
    }
    if model.catalog?.canManageEmotes == true {
      ToolbarItem(placement: .topBarTrailing) {
        Button(model.isSelecting ? "Done" : "Select") {
          if model.isSelecting {
            model.endSelection()
          } else {
            model.isSelecting = true
          }
        }
        .accessibilityIdentifier("emotes.select")
      }
    }
  }
}
