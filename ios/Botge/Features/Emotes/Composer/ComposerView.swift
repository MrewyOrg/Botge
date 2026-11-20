import BotgeKit
import SwiftUI
import UIKit

/// Edits the composition and copies its `/emote-compose` text.
struct ComposerView: View {
  /// Explains where the copied text goes.
  private static let footer: LocalizedStringResource = """
  Paste into the emotes option of /emote-compose. \
  Overlays draw over the emote before them.
  """

  /// Closes the sheet.
  @Environment(\.dismiss) private var dismiss
  /// Counts copies, so each copy triggers feedback.
  @State private var copies = 0
  /// Whether the clear confirmation is showing.
  @State private var isConfirmingClear = false

  /// The composition being edited.
  @Binding var composition: Composition

  var body: some View {
    NavigationStack {
      List {
        Section("Preview") {
          ComposerPreview(columns: composition.columns)
        }
        layersSection
        Section("Command Text") {
          Text(composition.commandText)
            .font(.body.monospaced())
            .textSelection(.enabled)
            .accessibilityIdentifier("composer.text")
        }
      }
      .navigationTitle("Composition")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { toolbar }
      .sensoryFeedback(.success, trigger: copies)
    }
  }

  /// The layers in order, deletable and movable while editing.
  private var layersSection: some View {
    Section {
      ForEach(Array(composition.layers.enumerated()), id: \.offset) { _, layer in
        Label(layer.name, systemImage: layer.isOverlay ? "square.on.square" : "square")
      }
      .onDelete { offsets in
        offsets.sorted(by: >).forEach { composition.remove(at: $0) }
      }
      .onMove { composition.move(fromOffsets: $0, toOffset: $1) }
    } header: {
      Text("Layers (\(composition.layers.count)/\(Composition.maxLayers))")
    } footer: {
      Text(Self.footer)
    }
  }

  /// Copy, clear, edit and done controls.
  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .confirmationAction) {
      Button("Done") { dismiss() }
    }
    ToolbarItem(placement: .topBarLeading) {
      EditButton()
    }
    ToolbarItemGroup(placement: .bottomBar) {
      Button("Clear", systemImage: "trash", role: .destructive) { isConfirmingClear = true }
        .disabled(composition.layers.isEmpty)
        .accessibilityIdentifier("composer.clear")
        .confirmationDialog("Clear the composition?", isPresented: $isConfirmingClear) {
          Button("Clear All Emotes", role: .destructive) {
            composition.clear()
          }
        } message: {
          Text("This removes every emote from the composition.")
        }
      Spacer()
      Button("Copy", systemImage: "doc.on.doc") {
        UIPasteboard.general.string = composition.commandText
        copies += 1
      }
      .disabled(composition.layers.isEmpty)
      .accessibilityIdentifier("composer.copy")
    }
  }

  /// Creates the editor.
  ///
  /// - Parameter composition: The composition being edited.
  init(composition: Binding<Composition>) {
    _composition = composition
  }
}
