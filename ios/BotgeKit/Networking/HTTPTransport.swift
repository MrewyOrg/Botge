public import Foundation

/// Sends HTTP requests; `URLSession` conforms, and tests substitute recorded responses.
public protocol HTTPTransport: Sendable {
  /// Sends `request` and returns the body and response.
  ///
  /// - Throws: A `URLError` or other transport failure.
  func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPTransport {
  /// Sends `request` without a task delegate.
  ///
  /// - Throws: A `URLError` when the request fails before a response arrives.
  public func data(for request: URLRequest) async throws -> (Data, URLResponse) {
    try await data(for: request, delegate: nil)
  }
}
