import BotgeKit
import SwiftUI
import UIKit

/// Actions for one emote, shared by the context menu and the preview sheet.
struct EmoteActions: View {
  /// The emote acted on.
  let emote: CatalogEmote
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    Button("Add to Composition", systemImage: "plus.square.on.square") {
      model.compose(emote)
    }
    .disabled(emote.composeToken == nil || model.composition.isFull)
    Button("Copy Name", systemImage: "doc.on.doc") {
      UIPasteboard.general.string = emote.name
      model.notice = String(localized: "Copied \(emote.name).")
    }
    ShareLink(item: emote.name)
    if model.canRemove(emote) {
      Button("Remove from Server", systemImage: "trash", role: .destructive) {
        Task { await model.remove(emote) }
      }
    }
  }
}
