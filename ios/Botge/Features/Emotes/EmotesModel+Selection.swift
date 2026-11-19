import BotgeKit
import Foundation

extension EmotesModel {
  /// The batch action for the current source: adding discovered emotes, removing added ones.
  var batchAction: EmoteAction {
    if source == .server {
      .remove
    } else {
      .add
    }
  }

  /// Whether `emote` can take part in the current batch action.
  ///
  /// - Parameter emote: A visible emote.
  /// - Returns: Whether it can be selected.
  func isSelectable(_ emote: CatalogEmote) -> Bool {
    if batchAction == .add {
      canAdd(emote)
    } else {
      canRemove(emote)
    }
  }

  /// Selects or deselects `emote`, up to ``BotgeAPI/maxBatch`` emotes.
  ///
  /// - Parameter emote: A visible emote.
  func toggleSelection(_ emote: CatalogEmote) {
    if selection.remove(emote.id) != nil {
      play(.selection)
      return
    }
    guard isSelectable(emote) else {
      notice = batchAction == .add
        ? String(localized: "\(emote.name) is already on the server.")
        : String(localized: "Only emotes the server added can be removed.")
      play(.failure)
      return
    }
    guard selection.count < BotgeAPI.maxBatch else {
      notice = String(localized: "Select at most \(BotgeAPI.maxBatch) emotes at a time.")
      play(.failure)
      return
    }

    selection.insert(emote.id)
    play(.selection)
  }

  /// Leaves selection mode and clears the selection.
  func endSelection() {
    isSelecting = false
    selection.removeAll()
  }

  /// Applies ``batchAction`` to the selection, asking first when it removes emotes.
  func requestBatch() async {
    if batchAction == .remove {
      pendingRemoval = .selection(count: selection.count)
    } else {
      await applyBatch()
    }
  }

  /// Applies ``batchAction`` to the selected emotes and reports the outcome.
  func applyBatch() async {
    let ids = visibleEmotes.filter { selection.contains($0.id) }.compactMap(\.sevenTVID)
    guard let api = app.api, !ids.isEmpty else {
      return
    }

    do {
      let results = try await api.changeEmotes(
        guild: guild.id,
        action: batchAction,
        sevenTVIDs: ids
      )
      let failed = results.filter { !$0.succeeded }
      notice = failed.isEmpty
        ? String(localized: "Updated \(results.count) emotes.")
        : String(localized: "\(failed.count) of \(results.count) failed: \(failed[0].message)")
      play(failed.isEmpty ? .success : .warning)
      endSelection()
      await load()
    } catch .signedOut {
      await app.signOut()
    } catch {
      notice = error.message
      play(.failure)
    }
  }
}
