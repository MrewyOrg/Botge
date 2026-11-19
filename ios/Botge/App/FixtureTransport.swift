#if DEBUG
import BotgeKit
import Foundation

/// Answers UI-test requests from fixtures, so UI tests never reach the network.
///
/// `POST /guilds` returns one fixture server; every other request fails as if offline.
struct FixtureTransport: HTTPTransport {
  /// The fixture server list.
  private static let guilds: Data = .init(
    """
    {"guilds":[{"id":"100000000000000001","name":"Fixture Server","icon":null,\
    "administrator":true}]}
    """.utf8
  )
  /// HTTP 200.
  private static let okStatus = 200

  /// Answers fixture routes.
  ///
  /// - Throws: `URLError(.notConnectedToInternet)` for every request without a fixture.
  func data(for request: URLRequest) throws -> (Data, URLResponse) {
    guard let url = request.url, url.lastPathComponent == "guilds",
          let response = HTTPURLResponse(
            url: url,
            statusCode: Self.okStatus,
            httpVersion: nil,
            headerFields: nil
          )
    else {
      throw URLError(.notConnectedToInternet)
    }

    return (Self.guilds, response)
  }
}
#endif
