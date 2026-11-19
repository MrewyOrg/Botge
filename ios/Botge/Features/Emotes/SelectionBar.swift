import BotgeKit
import SwiftUI

/// Applies the batch action to the selected emotes while selection mode is on.
struct SelectionBar: View {
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    if model.isSelecting {
      Button {
        Task { await model.applyBatch() }
      } label: {
        Text(title)
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(model.selection.isEmpty)
      .padding()
      .accessibilityIdentifier("emotes.batch")
    }
  }

  /// The button title for the current action and count.
  private var title: LocalizedStringResource {
    let count = model.selection.count
    return model.batchAction == .add
      ? "Add \(count) to Server"
      : "Remove \(count) from Server"
  }
}
