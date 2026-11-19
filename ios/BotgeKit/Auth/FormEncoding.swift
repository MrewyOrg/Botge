import Foundation

/// `application/x-www-form-urlencoded` encoding for OAuth request bodies.
enum FormEncoding {
  /// RFC 3986 unreserved characters; everything else is percent-encoded.
  private static let unreserved: CharacterSet = .init(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  )

  /// Encodes ordered fields as `name=value` pairs joined by `&`.
  static func encode(_ fields: [(String, String)]) -> String {
    fields
      .map { "\(escape($0.0))=\(escape($0.1))" }
      .joined(separator: "&")
  }

  /// Percent-encodes everything except unreserved characters.
  private static func escape(_ text: String) -> String {
    text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
  }
}
