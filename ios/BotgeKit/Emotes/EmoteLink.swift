public import Foundation

/// The public web page of an emote, for sharing.
public enum EmoteLink {
  /// Shares the 7TV page by ID, with the CDN image as a fallback.
  ///
  /// - Parameter emote: A catalog or discovered emote.
  /// - Returns: The page URL, or an allowlisted image URL when the ID is unavailable.
  public static func url(for emote: CatalogEmote) -> URL? {
    if let id = emote.sevenTVID, SevenTVID.isValid(id) {
      return URL(string: "https://7tv.app/emotes/\(id)")
    }

    return EmoteImageURL.url(for: emote.image)
  }
}
