import BotgeKit
import SwiftUI

/// The 7TV set whose emotes the server uses.
struct EmoteSourcesSection: View {
  /// The server's settings state.
  @Bindable private var model: ServerModel

  var body: some View {
    Section {
      field("7TV Set", prompt: "Set ID", text: $model.policyDraft.sevenTVSet.orEmpty)
        .accessibilityIdentifier("server.sources.7tv")
    } header: {
      Text("Emote Sources")
    } footer: {
      if model.policyDraft.isSevenTVSetValid {
        Text("Leave the set empty to disable it.")
      } else {
        Text("A 7TV set ID has 24 or 26 letters and digits.")
          .foregroundStyle(.red)
      }
    }
    .textInputAutocapitalization(.never)
    .autocorrectionDisabled()
  }

  /// Creates the section.
  ///
  /// - Parameter model: The server's settings state.
  init(model: ServerModel) {
    self.model = model
  }

  /// A labelled text field with its value on the trailing side, as in iOS settings.
  ///
  /// - Parameters:
  ///   - title: The row label.
  ///   - prompt: The placeholder.
  ///   - text: The edited value.
  /// - Returns: The row.
  private func field(
    _ title: LocalizedStringResource,
    prompt: LocalizedStringResource,
    text: Binding<String>
  )
    -> some View
  {
    LabeledContent {
      TextField(text: text, prompt: Text(prompt)) {
        Text(title)
      }
      .multilineTextAlignment(.trailing)
    } label: {
      Text(title)
    }
  }
}
