import BotgeKit
import Foundation
import Observation

/// One server's catalog, search, composition and pending actions for the Emotes tab.
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
  /// The search and filter settings.
  var filter: EmoteFilter = .init()
  /// The emotes collected for `/emote-compose`.
  var composition: Composition = .init()
  /// The open sheet, if any.
  var sheet: EmotesSheet?
  /// Where the grid takes its emotes from.
  var source: EmotesSource = .server
  /// Loaded 7TV discovery results.
  var discovery: DiscoveryState = .init()
  /// Whether taps select emotes for a batch action instead of previewing them.
  var isSelecting = false
  /// IDs of the selected emotes.
  var selection: Set<String> = []

  /// The app-wide model, for the API, 7TV and sign-out.
  let app: AppModel

  /// The emotes the grid shows: the filtered catalog, or discovery results with server state.
  var visibleEmotes: [CatalogEmote] {
    guard source != .server else {
      return filter.matchingEmotes(in: catalog?.emotes ?? [])
    }

    return discovery.emotes.map { catalog?.resolving($0) ?? $0 }
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
      failure = error
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
      await load()
    } catch .signedOut {
      await app.signOut()
    } catch {
      notice = error.message
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
    return added
  }
}
