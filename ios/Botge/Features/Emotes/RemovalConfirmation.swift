import BotgeKit
import SwiftUI

/// Asks to confirm a pending removal, anchored to the view that requested it.
///
/// Confirmation dialogs point at the view they are attached to, so each trigger attaches its own:
/// a tile for a single emote and the selection bar for a batch.
struct RemovalConfirmation: ViewModifier {
  /// The server's catalog state.
  let model: EmotesModel
  /// Whether a pending removal belongs to this view.
  let isOwned: (PendingRemoval) -> Bool

  /// The confirmation's title.
  private var title: LocalizedStringResource {
    switch model.pendingRemoval {
    case let .single(emote):
      "Remove \(emote.name) from the server?"

    case let .selection(count):
      "Remove \(count) emotes from the server?"

    case nil:
      "Remove from the server?"
    }
  }

  /// Shows the confirmation while this view's removal is pending; dismissing it cancels it.
  private var isPresented: Binding<Bool> {
    Binding {
      model.pendingRemoval.map(isOwned) ?? false
    } set: { isShown in
      if !isShown {
        model.pendingRemoval = nil
      }
    }
  }

  func body(content: Content) -> some View {
    content.confirmationDialog(
      title,
      isPresented: isPresented,
      titleVisibility: .visible,
      presenting: model.pendingRemoval
    ) { removal in
      Button("Remove", role: .destructive) {
        Task { await model.confirm(removal) }
      }
    } message: { _ in
      Text("Everyone in \(model.guild.name) loses these emotes.")
    }
  }
}

extension View {
  /// Confirms removals of `emote` from the server, anchored to this view.
  ///
  /// The same emote can show on several source pages; only the page in view confirms.
  ///
  /// - Parameters:
  ///   - emote: The emote this view shows.
  ///   - source: The source page this view is on.
  ///   - model: The server's catalog state.
  /// - Returns: The view with the confirmation attached.
  func confirmsRemoval(
    of emote: CatalogEmote,
    on source: EmotesSource,
    model: EmotesModel
  )
    -> some View
  {
    modifier(RemovalConfirmation(model: model) { removal in
      if case let .single(pending) = removal {
        return pending.id == emote.id && model.source == source
      }

      return false
    })
  }

  /// Confirms batch removals of the selected emotes, anchored to this view.
  ///
  /// - Parameter model: The server's catalog state.
  /// - Returns: The view with the confirmation attached.
  func confirmsBatchRemoval(model: EmotesModel) -> some View {
    modifier(RemovalConfirmation(model: model) { removal in
      if case .selection = removal {
        return true
      }

      return false
    })
  }
}
