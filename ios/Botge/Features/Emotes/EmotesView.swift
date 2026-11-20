import BotgeKit
import SwiftUI

/// The Emotes tab for one server: source, search, filters, the grid, preview and composer.
///
/// The title stays inline and the search field stays visible, so the navigation bar keeps one
/// height and the source picker below it never drifts while the grid scrolls or bounces. The
/// sources are pages: swiping sideways moves between Server, Trending and Top like the picker.
struct EmotesView: View {
  /// The server's catalog state.
  @State private var model: EmotesModel
  /// Whether the search field has the keyboard; it is dismissed before a sheet opens, since a
  /// visible keyboard makes the preview open at full height.
  @FocusState private var isSearchFocused: Bool

  var body: some View {
    // A paging scroll view keeps every page alive, so each grid keeps its own scroll position.
    ScrollView(.horizontal) {
      HStack(spacing: 0) {
        ForEach(EmotesSource.choices, id: \.self) { source in
          EmotesContent(model: model, source: source)
            .containerRelativeFrame(.horizontal)
            // Only the page in view is readable; VoiceOver switches pages with the picker.
            .accessibilityHidden(source != model.source)
            .task(id: DiscoveryRequest(source: source, filter: model.filter(for: source))) {
              await model.syncDiscovery(for: source)
            }
        }
      }
      .scrollTargetLayout()
    }
    .scrollTargetBehavior(.paging)
    .scrollPosition(id: page)
    .scrollIndicators(.hidden)
    .scrollEdgeEffectStyle(.soft, for: .vertical)
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
    .failureAlert($model.actionFailure)
    .hapticFeedback(model.haptic)
    .task { await model.load() }
    .task { await model.watch() }
  }

  /// The search prompt for the current source.
  private var searchPrompt: LocalizedStringResource {
    if model.source == .server {
      "Search server emotes"
    } else {
      "Search 7TV"
    }
  }

  /// The page in view, following the source picker both ways.
  private var page: Binding<EmotesSource?> {
    Binding {
      model.source
    } set: { source in
      if let source {
        model.source = source
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
    self.init(model: EmotesModel(guild: guild, app: app))
  }

  /// Creates the tab for an existing model.
  ///
  /// - Parameter model: The server's catalog state.
  init(model: EmotesModel) {
    _model = State(initialValue: model)
  }
}
