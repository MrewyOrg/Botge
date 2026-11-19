/// The provider that owns an emote, matching the Rust `Source` serialization.
public enum EmoteSource: String, CaseIterable, Codable, Sendable {
  /// BTTV global and channel feeds.
  case betterTTV = "BTTV"
  /// FrankerFaceZ global and channel feeds.
  case frankerFaceZ = "FFZ"
  /// 7TV sets and individual additions.
  case sevenTV = "7TV"
  /// Twitch global emotes.
  case twitch = "Twitch"

  /// The provider CDN host that serves this source's images.
  public var cdnHost: String {
    switch self {
    case .betterTTV:
      "cdn.betterttv.net"

    case .frankerFaceZ:
      "cdn.frankerfacez.com"

    case .sevenTV:
      "cdn.7tv.app"

    case .twitch:
      "static-cdn.jtvnw.net"
    }
  }

  /// The catalog path prefix, for example `7tv` in `/7tv-cdn/emote/…`.
  public var pathPrefix: String {
    switch self {
    case .betterTTV:
      "bttv"

    case .frankerFaceZ:
      "ffz"

    case .sevenTV:
      "7tv"

    case .twitch:
      "twitch"
    }
  }
}
