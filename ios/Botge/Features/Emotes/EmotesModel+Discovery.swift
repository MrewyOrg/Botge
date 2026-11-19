import BotgeKit
import Foundation

extension EmotesModel {
  /// How long typing pauses before discovery searches 7TV.
  private static let searchDelay: Duration = .milliseconds(searchDelayMilliseconds)
  /// ``searchDelay`` in milliseconds.
  private static let searchDelayMilliseconds = 350

  /// Loads the current ranking when it has nothing for the current search yet.
  ///
  /// Results already loaded for the same search are kept, so switching sources does not reload
  /// them. A changed search waits for typing to pause first; cancelling the task cancels it.
  func syncDiscovery() async {
    guard case let .discovery(mode) = source else {
      return
    }

    let wanted = filter
    let state = discoveries[mode]
    if state?.isCurrent(for: wanted) == true {
      return
    }
    if state != nil {
      try? await Task.sleep(for: Self.searchDelay)
      guard !Task.isCancelled else {
        return
      }
    }

    await reloadDiscovery(mode)
  }

  /// Replaces a ranking's results with the first page for the current search.
  ///
  /// - Parameter mode: The ranking to reload.
  func reloadDiscovery(_ mode: DiscoveryMode) async {
    discoveries[mode] = DiscoveryState(filter: filter)
    await loadMoreDiscovery(mode)
  }

  /// Loads the next page of the current ranking, if any, and appends it.
  func loadMoreDiscovery() async {
    if case let .discovery(mode) = source {
      await loadMoreDiscovery(mode)
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
      play(.success)
      await load()
    } catch .signedOut {
      await app.signOut()
    } catch {
      notice = error.message
      play(.failure)
    }
  }

  /// Loads the next page of `mode`, if any, and appends it.
  ///
  /// A result that arrives after the search changed is dropped, and a cancelled load records no
  /// failure.
  ///
  /// - Parameter mode: The ranking to page.
  private func loadMoreDiscovery(_ mode: DiscoveryMode) async {
    guard var state = discoveries[mode], !state.isLoading, state.page == 0 || state.hasMore
    else {
      return
    }

    let requested = state.filter
    let next = state.page + 1
    state.isLoading = true
    discoveries[mode] = state
    let result: Result<DiscoveryPage, APIError>
    do {
      result = try await .success(app.discovery.page(mode, number: next, filter: requested))
    } catch {
      result = .failure(error)
    }
    guard var current = discoveries[mode], current.filter == requested, current.page == next - 1
    else {
      return
    }

    current.isLoading = false
    switch result {
    case let .success(page):
      current.emotes += page.emotes
      current.page = next
      current.pageCount = page.pageCount
      current.failure = nil

    case let .failure(error):
      current.failure = Task.isCancelled ? nil : error
    }
    discoveries[mode] = current
  }
}
