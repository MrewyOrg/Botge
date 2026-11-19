import BotgeKit
import SwiftUI

/// Switches the grid between the server's catalog and 7TV's rankings.
struct EmotesSourcePicker: View {
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    @Bindable var model = model
    Picker("Source", selection: $model.source) {
      ForEach(EmotesSource.choices, id: \.self) { source in
        Text(source.title).tag(source)
      }
    }
    .pickerStyle(.segmented)
    .padding(.horizontal)
    .padding(.vertical, Metrics.tightSpacing)
    .onChange(of: model.source) {
      model.endSelection()
    }
    .accessibilityIdentifier("emotes.source")
  }
}
