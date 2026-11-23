/// The provider that owns an emote, matching the Rust `Source` serialization.
public enum EmoteSource: String, CaseIterable, Codable, Sendable {
  /// 7TV sets and individual additions.
  case sevenTV = "7TV"

  /// The CDN host serving 7TV images.
  public var cdnHost: String {
    "cdn.7tv.app"
  }

  /// The path prefix in catalog image URLs.
  public var pathPrefix: String {
    "7tv"
  }
}
