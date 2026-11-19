public import Foundation

/// Links that open a part of the app, such as the Guess tab from the Live Activity.
///
/// The scheme is the build's bundle prefix (`BotgeURLScheme` in the Info.plist), so builds of
/// different deployments never open each other.
public enum AppLink: String, CaseIterable, Sendable {
  /// The Emotes tab.
  case emotes
  /// The Guess tab.
  case guess

  /// The Info.plist key that holds the URL scheme.
  public static let schemeKey = "BotgeURLScheme"

  /// Reads a link, accepting only `scheme` and a known host, such as `dev.example.botge://guess`.
  ///
  /// - Parameters:
  ///   - url: The opened URL.
  ///   - scheme: This build's URL scheme.
  public init?(url: URL, scheme: String) {
    guard !scheme.isEmpty, url.scheme?.lowercased() == scheme.lowercased(),
          let host = url.host(), let link = Self(rawValue: host.lowercased())
    else {
      return nil
    }

    self = link
  }

  /// The URL that opens this part of the app.
  ///
  /// - Parameter scheme: This build's URL scheme.
  /// - Returns: The URL, or `nil` for an invalid scheme.
  public func url(scheme: String) -> URL? {
    guard !scheme.isEmpty else {
      return nil
    }

    return URL(string: "\(scheme)://\(rawValue)")
  }
}
