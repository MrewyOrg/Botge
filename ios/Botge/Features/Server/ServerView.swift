import BotgeKit
import SwiftUI

/// The Server tab: voice settings and emote policy for administrators, and everyone's own
/// emote border.
///
/// Edits are drafts until Save; Discard restores the saved values after a confirmation.
struct ServerView: View {
  /// The server's settings state.
  @State private var model: ServerModel
  /// Whether the discard confirmation is showing.
  @State private var isConfirmingDiscard = false

  var body: some View {
    content
      .navigationTitle("Server")
      .toolbar { toolbar }
      .failureAlert($model.saveFailure)
      .hapticFeedback(model.haptic)
      .task { await model.load() }
      .onChange(of: model.hasChanges, initial: true) { _, changed in
        model.app.hasUnsavedServerChanges = changed
      }
  }

  /// The settings form, or the loading or failure state.
  @ViewBuilder private var content: some View {
    if let failure = model.failure, !model.hasLoadedBorder {
      ContentUnavailableView {
        Label("Settings Unavailable", systemImage: "wifi.exclamationmark")
      } description: {
        Text(failure.message)
      } actions: {
        Button("Try Again") {
          Task { await model.load() }
        }
      }
    } else if !model.hasLoaded {
      ProgressView("Loading Settings")
    } else {
      Form {
        if model.isAdministrator {
          VoiceSection(model: model)
          EmoteSourcesSection(model: model)
          EmoteManagersSection(model: model)
          if let api = model.app.api {
            NavigationLink("Catalog History") {
              CatalogHistoryView(api: api, guild: model.guild.id) {
                await model.load()
              }
            }
            .disabled(model.hasChanges)
            .accessibilityIdentifier("server.catalog-history")
          }
        } else {
          Section {
            Label(
              "Only server administrators can change Botge's voice settings and emote sources.",
              systemImage: "lock"
            )
            .foregroundStyle(.secondary)
          }
        }
        BorderSection(model: model)
      }
      .disabled(model.isSaving)
      .scrollDismissesKeyboard(.interactively)
      .refreshable { await model.load() }
    }
  }

  /// Save and Discard.
  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if model.hasChanges {
      ToolbarItem(placement: .cancellationAction) {
        Button("Discard") {
          isConfirmingDiscard = true
        }
        .disabled(model.isSaving)
        .accessibilityIdentifier("server.discard")
        .confirmationDialog("Discard your changes?", isPresented: $isConfirmingDiscard) {
          Button("Discard Changes", role: .destructive) {
            model.discardChanges()
          }
        } message: {
          Text("The saved settings stay as they are.")
        }
      }
    }
    ToolbarItem(placement: .confirmationAction) {
      if model.isSaving {
        ProgressView()
      } else {
        Button("Save") {
          Task { await model.save() }
        }
        .disabled(!model.canSave)
        .accessibilityIdentifier("server.save")
      }
    }
  }

  /// Creates the tab for one server.
  ///
  /// - Parameters:
  ///   - guild: The server to show.
  ///   - app: The app-wide model.
  init(guild: SharedGuild, app: AppModel) {
    self.init(model: ServerModel(guild: guild, app: app))
  }

  /// Creates the tab for an existing model.
  ///
  /// - Parameter model: The server's settings state.
  init(model: ServerModel) {
    _model = State(initialValue: model)
  }
}
