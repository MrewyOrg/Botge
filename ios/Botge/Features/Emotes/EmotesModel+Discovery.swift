import BotgeKit
import Foundation

extension EmotesModel {
  /// How long typing pauses before discovery searches 7TV.
  private static let searchDelay: Duration = .milliseconds(searchDelayMilliseconds)
  /// ``searchDelay`` in milliseconds.
  private static let searchDelayMilliseconds = 350

  /// Loads the current source's ranking when it has nothing for its search yet.
  func syncDiscovery() async {
    await syncDiscovery(for: source)
  }

  /// Loads `source`'s ranking when it has nothing for its search yet.
  ///
  /// Results already loaded for the same search are kept, so switching sources does not reload
  /// them. A changed search waits for typing to pause first; cancelling the task cancels it.
  ///
  /// - Parameter source: A grid source; the server catalog needs no sync.
  func syncDiscovery(for source: EmotesSource) async {
    guard case let .discovery(mode) = source else {
      return
    }

    let wanted = filter(for: source)
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
    let wanted = filter(for: .discovery(mode))
    var state = DiscoveryState(filter: wanted)
    // Without a search or filter, the first page saved last time shows while it reloads.
    if wanted == EmoteFilter(), let saved = await app.snapshots.read(
      DiscoveryPage.self,
      key: Self.snapshotKey(mode)
    ) {
      state.emotes = saved.emotes
      state.pageCount = saved.pageCount
    }
    discoveries[mode] = state
    await loadMoreDiscovery(mode)
  }

  /// Loads the next page of the current ranking, if any, and appends it.
  func loadMoreDiscovery() async {
    await loadMoreDiscovery(for: source)
  }

  /// Loads the next page of `source`'s ranking, if any, and appends it.
  ///
  /// - Parameter source: A grid source; the server catalog has no pages.
  func loadMoreDiscovery(for source: EmotesSource) async {
    if case let .discovery(mode) = source {
      await loadMoreDiscovery(mode)
    }
  }

  /// The snapshot name of a ranking's first page.
  ///
  /// - Parameter mode: The ranking.
  /// - Returns: The key.
  static func snapshotKey(_ mode: DiscoveryMode) -> String {
    "discovery-\(mode.rawValue)"
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
      _ = try await api.addEmote(guild: guild.id, sevenTVID: id)
      play(.success)
      await load()
    } catch .signedOut {
      await app.signOut()
    } catch {
      actionFailure = error.message
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
      // The first page replaces a saved snapshot shown meanwhile; later pages append.
      current.emotes = next == 1 ? page.emotes : current.emotes + page.emotes
      current.page = next

      current.pageCount = page.pageCount
      current.failure = nil

    case let .failure(error):
      current.failure = Task.isCancelled ? nil : error
    }
    discoveries[mode] = current
    if case let .success(page) = result, next == 1, requested == EmoteFilter() {
      await app.snapshots.write(page, key: Self.snapshotKey(mode))
    }
  }
}
