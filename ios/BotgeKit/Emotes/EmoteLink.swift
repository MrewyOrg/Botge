public import Foundation

/// The public web page of an emote, for sharing.
public enum EmoteLink {
  /// The parts of a provider image path: `emote`, the ID, and the rest.
  private static let idPathParts = 3

  /// The emote's page on its provider, or its image URL when the provider has no page.
  ///
  /// 7TV emotes link to `7tv.app` by ID. BTTV and FFZ emotes link to their pages using the ID in
  /// the image path. Twitch emotes have no public page, so they share the image itself.
  ///
  /// - Parameter emote: A catalog or discovered emote.
  /// - Returns: The page URL, or `nil` when neither a page nor an image URL can be built.
  public static func url(for emote: CatalogEmote) -> URL? {
    if let id = emote.sevenTVID, SevenTVID.isValid(id) {
      return URL(string: "https://7tv.app/emotes/\(id)")
    }

    let image = EmoteImageURL.url(for: emote.image)
    let parts = image?.path().split(separator: "/") ?? []
    guard parts.count >= idPathParts, parts[0] == "emote",
          parts[1].allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) })
    else {
      return image
    }

    return switch emote.source {
    case .betterTTV:
      URL(string: "https://betterttv.com/emotes/\(parts[1])")

    case .frankerFaceZ:
      URL(string: "https://www.frankerfacez.com/emoticon/\(parts[1])")

    case .sevenTV, .twitch:
      image
    }
  }
}
