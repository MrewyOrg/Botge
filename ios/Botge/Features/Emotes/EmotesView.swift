import BotgeKit
import SwiftUI

/// The Emotes tab for one server: search, filters, the grid, preview and composer.
struct EmotesView: View {
  /// The server's catalog state.
  @State private var model: EmotesModel

  var body: some View {
    EmotesContent(model: model)
      .navigationTitle("Emotes")
      .searchable(text: $model.filter.query, prompt: "Search emotes")
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          EmoteFilterMenu(filter: $model.filter)
        }
        ToolbarItem(placement: .topBarLeading) {
          Button {
            model.sheet = .composer
          } label: {
            Label("Compose (\(model.composition.layers.count))", systemImage: "square.stack.3d.up")
          }
          .accessibilityIdentifier("emotes.compose")
        }
      }
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
      .refreshable { await model.load() }
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
