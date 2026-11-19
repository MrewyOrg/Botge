import BotgeKit

/// Emotes waiting for the user to confirm their removal from the server.
enum PendingRemoval: Identifiable {
  /// The selected emotes, removed as one batch.
  case selection(count: Int)
  /// One emote from its context menu.
  case single(CatalogEmote)

  /// The confirmation's identity.
  var id: String {
    switch self {
    case let .selection(count):
      "selection|\(count)"

    case let .single(emote):
      emote.id
    }
  }
}
