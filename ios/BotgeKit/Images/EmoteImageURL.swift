public import Foundation

/// Maps catalog image paths such as `/7tv-cdn/emote/ID/2x.webp` to provider CDN URLs.
///
/// The Activity loads these paths through Discord's URL mappings; the app requests the provider
/// directly. Only the four provider prefixes are accepted, mirroring the Activity's allowlist.
public enum EmoteImageURL {
  /// A catalog path splits into the provider prefix and the CDN path.
  private static let pathParts = 2

  /// Resolves a catalog path to its provider URL, or `nil` when the path is not allowlisted.
  public static func resolve(_ path: String) -> URL? {
    guard path.hasPrefix("/"), !path.contains("\\"), !path.contains("..") else {
      return nil
    }

    let parts = path.dropFirst().split(separator: "/", maxSplits: 1)
    guard parts.count == Self.pathParts,
          let source = EmoteSource.allCases.first(where: { parts[0] == "\($0.pathPrefix)-cdn" })
    else {
      return nil
    }

    return URL(string: "https://\(source.cdnHost)/\(parts[1])")
  }

  /// URLs to try in order for a catalog image, with Lockdown-safe formats first.
  ///
  /// 7TV publishes every scale in several formats, so its path is rewritten to each format in
  /// ``ImageFormat/preferred``. Other providers serve one URL, which is kept when its format is
  /// allowed. An unresolvable or disallowed path yields no candidates.
  public static func candidates(for path: String) -> [URL] {
    guard let url = resolve(path) else {
      return []
    }
    guard url.host() == EmoteSource.sevenTV.cdnHost else {
      let format = ImageFormat(path: url.path())
      return format.isAllowed || format == .unknown ? [url] : []
    }

    let base = url.deletingPathExtension()
    return ImageFormat.preferred.compactMap { format in
      var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
      components?.path = base.path() + "." + format.rawValue
      components?.query = url.query()
      return components?.url
    }
  }
}
