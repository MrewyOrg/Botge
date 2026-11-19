import BotgeKit
import SwiftUI

/// A sheet with a large animated preview, the emote's details and its actions.
struct EmotePreviewView: View {
  /// Side length of the preview image.
  private static let imageSize: CGFloat = 160

  /// Closes the sheet.
  @Environment(\.dismiss) private var dismiss

  /// The emote shown.
  let emote: CatalogEmote
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    NavigationStack {
      List {
        Section {
          EmoteImageView(path: emote.preview ?? emote.image, isAnimated: emote.isAnimated)
            .frame(width: Self.imageSize, height: Self.imageSize)
            .frame(maxWidth: .infinity)
            .accessibilityLabel(emote.name)
        }
        Section {
          EmoteActions(emote: emote, model: model)
        }
        Section {
          LabeledContent("Source", value: emote.source.rawValue)
          LabeledContent("Tags", value: emote.filterTags.joined(separator: ", "))
          if let token = emote.composeToken {
            LabeledContent("Compose Token", value: token)
          }
        }
      }
      .navigationTitle(emote.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        Button("Done") { dismiss() }
      }
    }
    .presentationDetents([.medium, .large])
  }
}
