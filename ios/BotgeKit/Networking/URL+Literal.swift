public import Foundation

extension URL {
  /// Creates a URL from a literal written in the source, such as a fixed service endpoint.
  ///
  /// An invalid literal becomes the root file URL, so requests to it fail instead of crashing
  /// the app; tests check every literal the app uses.
  ///
  /// - Parameter literal: An absolute URL.
  public init(literal: StaticString) {
    self = URL(string: "\(literal)") ?? URL(filePath: "/")
  }
}
