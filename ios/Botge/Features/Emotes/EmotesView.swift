import BotgeKit
import SwiftUI

/// The Emotes tab for one server: source, search, filters, the grid, preview and composer.
///
/// The title stays inline and the search field stays visible, so the navigation bar keeps one
/// height and the source picker below it never drifts while the grid scrolls or bounces.
struct EmotesView: View {
  /// Whether haptics play.
  @AppStorage(PreferenceKey.haptics) private var haptics = true
  /// The server's catalog state.
  @State private var model: EmotesModel
  /// Whether the search field has the keyboard; it is dismissed before a sheet opens, since a
  /// visible keyboard makes the preview open at full height.
  @FocusState private var isSearchFocused: Bool

  var body: some View {
    EmotesContent(model: model)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .navigationTitle("Emotes")
      .navigationBarTitleDisplayMode(.inline)
      .searchable(
        text: $model.filter.query,
        placement: .navigationBarDrawer(displayMode: .always),
        prompt: Text(searchPrompt)
      )
      .searchFocused($isSearchFocused)
      .onChange(of: model.sheet) { _, sheet in
        if sheet != nil {
          isSearchFocused = false
        }
      }
      .toolbar { EmotesToolbar(model: model) }
      .onChange(of: model.app.pendingSearch, initial: true) { _, query in
        guard let query else {
          return
        }

        model.source = .server
        model.filter.query = query
        model.app.pendingSearch = nil
      }
      .safeAreaBar(edge: .top) { EmotesSourcePicker(model: model) }
      .safeAreaInset(edge: .bottom) { SelectionBar(model: model) }
      .sheet(item: presentedSheet) { sheet in
        switch sheet {
        case .composer:
          ComposerView(composition: $model.composition)

        case let .preview(emote):
          EmotePreviewView(opened: emote, model: model)
        }
      }
      .confirmationDialog(
        removalTitle,
        isPresented: isConfirmingRemoval,
        titleVisibility: .visible,
        presenting: model.pendingRemoval
      ) { removal in
        Button("Remove", role: .destructive) {
          Task { await model.confirm(removal) }
        }
      } message: { _ in
        Text("Everyone in \(model.guild.name) loses these emotes.")
      }
      .overlay(alignment: .bottom) {
        NoticeBanner(notice: $model.notice)
      }
      .sensoryFeedback(trigger: model.haptic) { _, event in
        haptics ? event?.feedback : nil
      }
      .task { await model.load() }
      .task { await model.watch() }
      .task(id: DiscoveryRequest(source: model.source, filter: model.filter)) {
        await model.syncDiscovery()
      }
  }

  /// The search prompt for the current source.
  private var searchPrompt: LocalizedStringResource {
    if model.source == .server {
      "Search server emotes"
    } else {
      "Search 7TV"
    }
  }

  /// The removal confirmation's title.
  private var removalTitle: LocalizedStringResource {
    switch model.pendingRemoval {
    case let .single(emote):
      "Remove \(emote.name) from the server?"

    case let .selection(count):
      "Remove \(count) emotes from the server?"

    case nil:
      "Remove from the server?"
    }
  }

  /// Shows the confirmation while a removal is pending; dismissing it cancels the removal.
  private var isConfirmingRemoval: Binding<Bool> {
    Binding {
      model.pendingRemoval != nil
    } set: { isPresented in
      if !isPresented {
        model.pendingRemoval = nil
      }
    }
  }

  /// The open sheet; opening one first dismisses the search keyboard.
  private var presentedSheet: Binding<EmotesSheet?> {
    Binding {
      isSearchFocused ? nil : model.sheet
    } set: { sheet in
      model.sheet = sheet
    }
  }

  /// Creates the tab for one server.
  ///
  /// - Parameters:
  ///   - guild: The server to show.
  ///   - app: The app-wide model.
  init(guild: SharedGuild, app: AppModel) {
    _model = State(initialValue: EmotesModel(guild: guild, app: app))
  }
}
