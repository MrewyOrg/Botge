import BotgeKit
import SwiftUI

/// A sheet with a large animated preview, the emote's actions and its tags.
///
/// It always opens at half height and can be dragged to full height.
struct EmotePreviewView: View {
  /// Side length of the preview image.
  private static let imageSize: CGFloat = 128
  /// Space above and below the preview image.
  private static let imagePadding: CGFloat = 4

  /// Closes the sheet.
  @Environment(\.dismiss) private var dismiss
  /// The sheet height.
  @State private var detent: PresentationDetent = .medium
  /// Whether the removal confirmation is showing.
  @State private var isConfirmingRemoval = false

  /// The emote shown.
  let emote: CatalogEmote
  /// The server's catalog state.
  let model: EmotesModel

  var body: some View {
    NavigationStack {
      List {
        image
        Section {
          EmoteActions(emote: emote, model: model) {
            isConfirmingRemoval = true
          }
        }
        detailsSection
      }
      .listSectionSpacing(.compact)
      .contentMargins(.top, 0, for: .scrollContent)
      .navigationTitle(emote.name)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button(role: .close) { dismiss() }
            .accessibilityIdentifier("preview.close")
        }
      }
      .confirmationDialog(
        "Remove \(emote.name) from the server?",
        isPresented: $isConfirmingRemoval,
        titleVisibility: .visible,
        actions: removalActions,
        message: removalMessage
      )
    }
    .presentationDetents([.medium, .large], selection: $detent)
  }

  /// The large preview, centred without a row background.
  private var image: some View {
    EmoteImageView(path: emote.preview ?? emote.image, isAnimated: emote.isAnimated)
      .frame(width: Self.imageSize, height: Self.imageSize)
      .frame(maxWidth: .infinity)
      .padding(.vertical, Self.imagePadding)
      .listRowBackground(Color.clear)
      .accessibilityLabel(emote.name)
  }

  /// Whether to name the provider: discovery results always come from 7TV.
  private var showsSource: Bool {
    model.source == .server
  }

  /// The provider and tags, when there are any to show.
  @ViewBuilder private var detailsSection: some View {
    if showsSource || !emote.tags.isEmpty {
      Section {
        if showsSource {
          LabeledContent("Source", value: emote.source.rawValue)
        }
        if !emote.tags.isEmpty {
          LabeledContent("Tags", value: emote.tags.joined(separator: ", "))
        }
      }
    }
  }

  /// Confirms the removal, closing the sheet first.
  ///
  /// - Returns: The destructive button.
  private func removalActions() -> some View {
    Button("Remove", role: .destructive) {
      dismiss()
      Task { await model.remove(emote) }
    }
  }

  /// Explains who the removal affects.
  ///
  /// - Returns: The message text.
  private func removalMessage() -> some View {
    Text("Everyone in \(model.guild.name) loses this emote.")
  }
}
