import BotgeKit

/// The sheet the Emotes tab shows; one modifier presents every route.
enum EmotesSheet: Hashable, Identifiable {
  /// The composition editor.
  case composer
  /// The preview of one emote.
  case preview(CatalogEmote)

  /// The route's identity for `sheet(item:)`.
  var id: Self {
    self
  }
}
