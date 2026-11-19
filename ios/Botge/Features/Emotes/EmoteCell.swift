import BotgeKit
import SwiftUI

/// One grid tile that previews or selects its emote, with the emote's actions on long press.
struct EmoteCell: View {
  /// The emote shown.
  let emote: CatalogEmote
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    Button {
      if model.isSelecting {
        model.toggleSelection(emote)
      } else {
        model.sheet = .preview(emote)
      }
    } label: {
      EmoteTile(
        emote: emote,
        isSelected: model.selection.contains(emote.id),
        isSelecting: model.isSelecting
      )
    }
    .buttonStyle(.plain)
    .contextMenu {
      EmoteActions(emote: emote, model: model) {
        model.pendingRemoval = .single(emote)
      }
    }
  }
}
