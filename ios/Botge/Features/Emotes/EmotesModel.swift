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
  /// A short message about the last action, shown as a banner.
  var notice: String?
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
  /// The emote at the top of each source's grid, to restore its scroll position.
  private var scrollAnchors: [EmotesSource: String] = [:]

  /// The app-wide model, for the API, 7TV and sign-out.
  let app: AppModel

  /// The search and filter settings of the current source.
  var filter: EmoteFilter {
    get { filters[source] ?? EmoteFilter() }
    set { filters[source] = newValue }
  }

  /// The discovery results of the current source; empty for the server catalog.
  var discovery: DiscoveryState {
    guard case let .discovery(mode) = source else {
      return DiscoveryState()
    }

    return discoveries[mode] ?? DiscoveryState()
  }

  /// The emotes the grid shows: the filtered catalog, or discovery results with server state.
  var visibleEmotes: [CatalogEmote] {
    guard source != .server else {
      return filter.matchingEmotes(in: catalog?.emotes ?? [])
    }

    let found = discovery.emotes
    return catalog?.resolving(found) ?? found
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

  /// The emote at the top of `source`'s grid when it was last shown.
  ///
  /// - Parameter source: A grid source.
  /// - Returns: The emote ID, or `nil` to start at the top.
  func scrollAnchor(for source: EmotesSource) -> String? {
    scrollAnchors[source]
  }

  /// Remembers the emote at the top of `source`'s grid.
  ///
  /// - Parameters:
  ///   - id: The emote ID; `nil` keeps the previous anchor.
  ///   - source: The grid source.
  func setScrollAnchor(_ id: String?, for source: EmotesSource) {
    if let id, scrollAnchors[source] != id {
      scrollAnchors[source] = id
    }
  }

  /// Plays a haptic when the user allows them.
  ///
  /// - Parameter kind: What happened.
  func play(_ kind: HapticEvent.Kind) {
    haptic = HapticEvent(kind: kind, serial: (haptic?.serial ?? 0) + 1)
  }

  /// Whether `emote` can be removed: the member manages emotes and the server added it.
  ///
  /// - Parameter emote: A catalog emote.
  /// - Returns: Whether to offer removal.
  func canRemove(_ emote: CatalogEmote) -> Bool {
    catalog?.canManageEmotes == true && emote.isAdded && emote.sevenTVID != nil
  }

  /// Loads or reloads the catalog; a rejected login returns to the login screen.
  func load() async {
    guard let api = app.api else {
      return
    }

    do {
      catalog = try await api.catalog(guild: guild.id)
      failure = nil
    } catch .signedOut {
      await app.signOut()
    } catch {
      if !Task.isCancelled {
        failure = error
      }
    }
  }

  /// Reloads what the current source shows, for pull to refresh.
  func refresh() async {
    if case let .discovery(mode) = source {
      await reloadDiscovery(mode)
    } else {
      await load()
    }
  }

  /// Reloads the catalog whenever the server reports a change, until the task is cancelled.
  func watch() async {
    guard let watch = app.makeCatalogWatch() else {
      return
    }

    do {
      try await watch.run(guild: guild.id) { [weak self] in
        await self?.load()
      }
    } catch {
      await app.signOut()
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
      notice = try await api.removeEmote(guild: guild.id, sevenTVID: id)
      play(.success)
      await load()
    } catch .signedOut {
      await app.signOut()
    } catch {
      notice = error.message
      play(.failure)
    }
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

  /// Adds `emote` to the composition, or explains why it cannot be added.
  ///
  /// - Parameter emote: A catalog emote.
  /// - Returns: Whether it was added.
  @discardableResult
  func compose(_ emote: CatalogEmote) -> Bool {
    let added = composition.add(emote)
    notice = added
      ? String(localized: "Added \(emote.name) to the composition.")
      : String(localized: "\(emote.name) can't be composed or the composition is full.")
    play(added ? .impact : .failure)
    return added
  }
}
