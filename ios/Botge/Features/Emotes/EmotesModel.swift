import BotgeKit
import Foundation
import Observation

/// One server's catalog, searches, composition and pending actions for the Emotes tab.
///
/// Each source keeps its own search, filters, loaded results and scroll position, so switching
/// between the server catalog and the 7TV rankings neither reloads nor resets them.
@Observable
final class EmotesModel {
  /// The server shown.
  let guild: SharedGuild
  /// The loaded catalog, or `nil` before the first load succeeds.
  private(set) var catalog: Catalog?
  /// Why the last load failed, if it did.
  private(set) var failure: APIError?
  /// Why the last action failed, shown in an alert.
  var actionFailure: String?
  /// The emotes collected for `/emote-compose`.
  var composition: Composition = .init()
  /// The open sheet, if any.
  var sheet: EmotesSheet?
  /// Where the grid takes its emotes from.
  var source: EmotesSource = .server
  /// Loaded 7TV discovery results by ranking.
  var discoveries: [DiscoveryMode: DiscoveryState] = [:]
  /// Whether taps select emotes for a batch action instead of previewing them.
  var isSelecting = false
  /// IDs of the selected emotes.
  var selection: Set<String> = []
  /// A removal waiting for confirmation.
  var pendingRemoval: PendingRemoval?
  /// The last haptic to play.
  private(set) var haptic: HapticEvent?
  /// The search and filter settings by source.
  private var filters: [EmotesSource: EmoteFilter] = [:]
  /// The reload that change notices started, while it runs.
  private var reload: Task<Void, Never>?
  /// Whether a change notice arrived since the running reload started.
  private var isReloadPending = false

  /// The app-wide model, for the API, 7TV and sign-out.
  let app: AppModel

  /// The search and filter settings of the current source.
  var filter: EmoteFilter {
    get { filters[source] ?? EmoteFilter() }
    set { filters[source] = newValue }
  }

  /// The discovery results of the current source; empty for the server catalog.
  var discovery: DiscoveryState {
    discovery(for: source)
  }

  /// The emotes the current source's grid shows.
  var visibleEmotes: [CatalogEmote] {
    visibleEmotes(for: source)
  }

  /// Creates a model for one server.
  ///
  /// - Parameters:
  ///   - guild: The server to show.
  ///   - app: The app-wide model.
  init(guild: SharedGuild, app: AppModel) {
    self.guild = guild
    self.app = app
  }

  deinit {
    // Tasks that use the model are owned by the view and end with it.
  }

  /// The search and filter settings of `source`.
  ///
  /// - Parameter source: A grid source.
  /// - Returns: Its filter.
  func filter(for source: EmotesSource) -> EmoteFilter {
    filters[source] ?? EmoteFilter()
  }

  /// The discovery results of `source`; empty for the server catalog.
  ///
  /// - Parameter source: A grid source.
  /// - Returns: Its loaded results and paging.
  func discovery(for source: EmotesSource) -> DiscoveryState {
    guard case let .discovery(mode) = source else {
      return DiscoveryState()
    }

    return discoveries[mode] ?? DiscoveryState()
  }

  /// The emotes `source`'s grid shows: the filtered catalog, or discovery results with server
  /// state.
  ///
  /// - Parameter source: A grid source.
  /// - Returns: The emotes in display order.
  func visibleEmotes(for source: EmotesSource) -> [CatalogEmote] {
    guard source != .server else {
      return filter(for: source).matchingEmotes(in: catalog?.emotes ?? [])
    }

    let found = discovery(for: source).emotes
    return catalog?.resolving(found) ?? found
  }

  /// Plays a haptic when the user allows them.
  ///
  /// - Parameter kind: What happened.
  func play(_ kind: HapticEvent.Kind) {
    haptic = HapticEvent(kind, after: haptic)
  }

  /// Whether `emote` can be removed: the member manages emotes and the server added it.
  ///
  /// - Parameter emote: A catalog emote.
  /// - Returns: Whether to offer removal.
  func canRemove(_ emote: CatalogEmote) -> Bool {
    catalog?.canManageEmotes == true && emote.isAdded && emote.sevenTVID != nil
  }

  /// Loads or reloads the catalog; a rejected login returns to the login screen.
  ///
  /// On the first load the catalog saved last time shows at once while the fresh one loads.
  func load() async {
    guard let api = app.api else {
      return
    }

    let key = "catalog-\(guild.id)"
    if catalog == nil {
      let saved = await app.snapshots.read(Catalog.self, key: key)
      // A reload that finished meanwhile is newer than the snapshot.
      catalog = catalog ?? saved
    }
    do {
      let fresh = try await api.catalog(guild: guild.id)
      catalog = fresh
      failure = nil
      await app.snapshots.write(fresh, key: key)
    } catch .signedOut {
      await app.signOut()
    } catch {
      if !Task.isCancelled {
        failure = error
      }
    }
  }

  /// Reloads what the current source shows.
  func refresh() async {
    await refresh(source)
  }

  /// Reloads what `source` shows, for pull to refresh.
  ///
  /// - Parameter source: The grid source.
  func refresh(_ source: EmotesSource) async {
    if case let .discovery(mode) = source {
      await reloadDiscovery(mode)
    } else {
      await load()
    }
  }

  /// Reloads the catalog whenever the server reports a change, until the task is cancelled.
  ///
  /// Notices that arrive while a reload runs are combined into one more reload, so a batch of
  /// changes costs at most two catalog requests.
  func watch() async {
    guard let watch = app.makeCatalogWatch() else {
      return
    }

    do {
      try await watch.run(guild: guild.id) { [weak self] in
        await self?.catalogChanged()
      }
    } catch {
      await app.signOut()
    }
    reload?.cancel()
  }

  /// Starts a reload for a change notice, or marks one pending while a reload runs.
  func catalogChanged() {
    isReloadPending = true
    guard reload == nil else {
      return
    }

    reload = Task { [weak self] in
      while let self, isReloadPending, !Task.isCancelled {
        isReloadPending = false
        await load()
      }
      self?.reload = nil
    }
  }

  /// Removes an emote the server added, then reloads the catalog.
  ///
  /// - Parameter emote: An emote for which ``canRemove(_:)`` is true.
  func remove(_ emote: CatalogEmote) async {
    guard let api = app.api, let id = emote.sevenTVID else {
      return
    }

    do {
      _ = try await api.removeEmote(guild: guild.id, sevenTVID: id)
      play(.success)
      await load()
    } catch .signedOut {
      await app.signOut()
    } catch {
      actionFailure = error.message
      play(.failure)
    }
  }

  /// Asks the user to confirm removing `emote` from the server.
  ///
  /// - Parameter emote: An emote for which ``canRemove(_:)`` is true.
  func requestRemoval(of emote: CatalogEmote) {
    pendingRemoval = .single(emote)
  }

  /// Carries out a confirmed removal.
  ///
  /// - Parameter removal: The confirmed request.
  func confirm(_ removal: PendingRemoval) async {
    switch removal {
    case .selection:
      await applyBatch()

    case let .single(emote):
      await remove(emote)
    }
  }

  /// Adds `emote` to the composition; the composition badge shows the new count.
  ///
  /// - Parameter emote: A catalog emote.
  /// - Returns: Whether it was added.
  @discardableResult
  func compose(_ emote: CatalogEmote) -> Bool {
    let added = composition.add(emote)
    play(added ? .impact : .failure)
    return added
  }
}
