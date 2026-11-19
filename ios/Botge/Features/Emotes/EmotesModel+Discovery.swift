import BotgeKit
import Foundation

extension EmotesModel {
  /// Loads the first discovery page for the current source and filter.
  func reloadDiscovery() async {
    discovery = DiscoveryState()
    await loadMoreDiscovery()
  }

  /// Loads the next discovery page, if any, and appends it.
  func loadMoreDiscovery() async {
    guard case let .discovery(mode) = source, !discovery.isLoading,
          discovery.page == 0 || discovery.hasMore
    else {
      return
    }

    discovery.isLoading = true
    defer { discovery.isLoading = false }
    let next = discovery.page + 1
    do {
      let page = try await app.discovery.page(mode, number: next, filter: filter)
      discovery.emotes += page.emotes
      discovery.page = next
      discovery.pageCount = page.pageCount
      discovery.failure = nil
    } catch {
      discovery.failure = error
    }
  }

  /// Whether `emote` can be added: the member manages emotes and the server lacks it.
  ///
  /// - Parameter emote: A catalog or discovered emote.
  /// - Returns: Whether to offer adding.
  func canAdd(_ emote: CatalogEmote) -> Bool {
    catalog?.canManageEmotes == true && !emote.isAdded && emote.sevenTVID != nil
  }

  /// Adds a 7TV emote to the server, then reloads the catalog.
  ///
  /// - Parameter emote: An emote for which ``canAdd(_:)`` is true.
  func add(_ emote: CatalogEmote) async {
    guard let api = app.api, let id = emote.sevenTVID else {
      return
    }

    do {
      notice = try await api.addEmote(guild: guild.id, sevenTVID: id)
      await load()
    } catch .signedOut {
      await app.signOut()
    } catch {
      notice = error.message
    }
  }
}
