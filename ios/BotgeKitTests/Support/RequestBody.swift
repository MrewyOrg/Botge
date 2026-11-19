import Foundation

/// Decodes a form-encoded request body into a dictionary for assertions.
enum RequestBody {
  static func form(_ request: URLRequest) -> [String: String] {
    let text = String(bytes: request.httpBody ?? Data(), encoding: .utf8) ?? ""
    var components = URLComponents()
    components.percentEncodedQuery = text
    let items = components.queryItems ?? []
    return Dictionary(items.map { ($0.name, $0.value ?? "") }) { first, _ in first }
  }
}
