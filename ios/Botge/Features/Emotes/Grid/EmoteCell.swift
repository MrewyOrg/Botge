import BotgeKit
import SwiftUI

/// One grid tile that previews or selects its emote, with the emote's actions on long press.
struct EmoteCell: View {
  /// The emote shown.
  let emote: CatalogEmote
  /// The server's catalog state.
  let model: EmotesModel
  /// The source page the cell is on.
  let source: EmotesSource

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
    // While selecting, emotes the batch action cannot use are dimmed and ignore taps.
    .disabled(model.isSelecting && !model.canSelect(emote))
    .contextMenu {
      EmoteActions(emote: emote, model: model, requestRemoval: model.requestRemoval(of:))
    }
    .confirmsRemoval(of: emote, on: source, model: model)
  }
}
