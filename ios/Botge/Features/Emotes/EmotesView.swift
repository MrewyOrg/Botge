import BotgeKit
import SwiftUI

/// The Emotes tab for one server: source, search, filters, the grid, preview and composer.
struct EmotesView: View {
  /// How long typing pauses before discovery searches 7TV.
  private static let searchDelay: Duration = .milliseconds(searchDelayMilliseconds)
  /// ``searchDelay`` in milliseconds.
  private static let searchDelayMilliseconds = 350

  /// The server's catalog state.
  @State private var model: EmotesModel

  var body: some View {
    EmotesContent(model: model)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .navigationTitle("Emotes")
      .searchable(text: $model.filter.query, prompt: "Search emotes")
      .toolbar { EmotesToolbar(model: model) }
      .safeAreaInset(edge: .top) { EmotesSourcePicker(model: model) }
      .safeAreaInset(edge: .bottom) { SelectionBar(model: model) }
      .sheet(item: $model.sheet) { sheet in
        switch sheet {
        case .composer:
          ComposerView(composition: $model.composition)

        case let .preview(emote):
          EmotePreviewView(emote: emote, model: model)
        }
      }
      .overlay(alignment: .bottom) {
        NoticeBanner(notice: $model.notice)
      }
      .task { await model.load() }
      .task { await model.watch() }
      .task(id: DiscoveryRequest(source: model.source, filter: model.filter)) {
        guard model.source != .server else {
          return
        }

        try? await Task.sleep(for: Self.searchDelay)
        guard !Task.isCancelled else {
          return
        }

        await model.reloadDiscovery()
      }
      .refreshable {
        await model.load()
        if model.source != .server {
          await model.reloadDiscovery()
        }
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
