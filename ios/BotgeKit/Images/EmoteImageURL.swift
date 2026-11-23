public import Foundation

/// Maps catalog image paths such as `/7tv-cdn/emote/ID/2x.webp` to provider CDN URLs.
///
/// The Activity loads these paths through Discord's URL mapping. The app requests the 7TV CDN
/// directly and accepts only that catalog prefix.
public enum EmoteImageURL {
  /// A catalog path splits into the provider prefix and the CDN path.
  private static let pathParts = 2

  /// Resolves a catalog path to its provider URL, or `nil` when the path is not allowlisted.
  ///
  /// - Parameter path: A catalog image path.
  /// - Returns: The provider URL, or `nil`.
  public static func url(for path: String) -> URL? {
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

  /// The catalog path in the format the app loads: GIF for animated 7TV emotes, else PNG.
  ///
  /// 7TV publishes animated emotes as GIF and still ones as PNG next to WebP and AVIF. In Lockdown
  /// Mode ImageIO decodes WebP roughly twenty times slower than GIF, so the app avoids it.
  ///
  /// - Parameters:
  ///   - path: A catalog image path such as `/7tv-cdn/emote/ID/2x.webp`.
  ///   - isAnimated: Whether the provider advertises an animation.
  /// - Returns: The path to load.
  public static func loadPath(for path: String, isAnimated: Bool) -> String {
    guard path.hasPrefix("/\(EmoteSource.sevenTV.pathPrefix)-cdn/") else {
      return path
    }

    let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
    // Only the file name's extension is replaced; dots in folder names stay.
    let base = URL(filePath: String(parts[0]), directoryHint: .notDirectory)
      .deletingPathExtension()
      .path(percentEncoded: false)
    let query = parts.count > 1 ? "?" + parts[1] : ""
    return base + (isAnimated ? ".gif" : ".png") + query
  }

  /// The URL the app downloads for a load path.
  ///
  /// The path is requested as is, unless it names AVIF, which the app never requests.
  ///
  /// - Parameter path: A path from ``loadPath(for:isAnimated:)``.
  /// - Returns: The URL to download, or `nil` when the path is refused.
  public static func requestURL(for path: String) -> URL? {
    guard let url = url(for: path), url.pathExtension.lowercased() != "avif" else {
      return nil
    }

    return url
  }
}
