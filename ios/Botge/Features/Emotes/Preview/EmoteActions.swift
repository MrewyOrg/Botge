import BotgeKit
import SwiftUI
import UIKit

/// Actions for one emote, shared by the context menu and the preview sheet.
struct EmoteActions: View {
  /// The emote acted on.
  let emote: CatalogEmote
  /// The server's catalog state.
  let model: EmotesModel
  /// Asks to confirm removing the emote from the server.
  let requestRemoval: (CatalogEmote) -> Void

  var body: some View {
    Button("Add to Composition", systemImage: "plus.square.on.square") {
      model.compose(emote)
    }
    .disabled(emote.composeToken == nil || model.composition.isFull)
    Button("Copy Name", systemImage: "doc.on.doc") {
      UIPasteboard.general.string = emote.name
      model.notice = String(localized: "Copied \(emote.name).")
      model.play(.success)
    }
    if let link = EmoteLink.url(for: emote) {
      ShareLink(item: link, subject: Text(emote.name)) {
        Label("Share Link", systemImage: "square.and.arrow.up")
      }
    }
    // Changing the server comes last, whether it adds or removes.
    if model.canAdd(emote) {
      Button("Add to Server", systemImage: "plus.circle") {
        Task { await model.add(emote) }
      }
    }
    if model.canRemove(emote) {
      Button("Remove from Server", systemImage: "trash", role: .destructive) {
        requestRemoval(emote)
      }
    }
  }
}
