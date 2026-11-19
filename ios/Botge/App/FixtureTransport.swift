#if DEBUG
import BotgeKit
import Foundation

/// Answers UI-test requests from fixtures, so UI tests never reach the network.
///
/// `POST /guilds` returns one fixture server, `POST /catalog` a small catalog and 7TV's `gql`
/// endpoint one discovery result; every other request, including images, fails as if offline.
struct FixtureTransport: HTTPTransport {
  /// Fixture bodies by the request path's last component.
  private static let bodies: [String: String] = [
    "guilds": """
    {"guilds":[{"id":"100000000000000001","name":"Fixture Server","icon":null,\
    "administrator":true}]}
    """,
    "gql": """
    {"data":{"emotes":{"search":{"pageCount":1,"items":[{"id":"01234567890123456789012345",\
    "defaultName":"catJAM","tags":["cat"],"flags":{"animated":true,"nsfw":false,\
    "private":false,"publicListed":true,"defaultZeroWidth":false},\
    "images":[{"url":"https://cdn.7tv.app/emote/01234567890123456789012345/2x.webp"}]}]}}}}
    """,
    "catalog": """
    {"message":"Server emotes loaded.","canManageEmotes":true,"canComposeDiscovery":false,\
    "emotes":[{"name":"peepoHey","source":"7TV","image":"/7tv-cdn/emote/A/2x.webp",\
    "animated":true,"overlaying":false,"tags":["wave"],"added":true,"composeToken":"peepoHey",\
    "sevenTVId":"A"},{"name":"Kappa","source":"Twitch",\
    "image":"/twitch-cdn/emoticons/v2/25/default/dark/2.0","animated":false,"overlaying":false,\
    "tags":[],"added":false,"composeToken":"Kappa"}]}
    """
  ]
  /// HTTP 200.
  private static let okStatus = 200

  /// Answers fixture routes.
  ///
  /// - Parameter request: The request to answer.
  /// - Returns: The fixture body and a 200 response.
  /// - Throws: `URLError(.notConnectedToInternet)` for every request without a fixture.
  func data(for request: URLRequest) throws -> (Data, URLResponse) {
    guard let url = request.url,
          let body = Self.bodies[url.lastPathComponent],
          let response = HTTPURLResponse(
            url: url,
            statusCode: Self.okStatus,
            httpVersion: nil,
            headerFields: nil
          )
    else {
      throw URLError(.notConnectedToInternet)
    }

    return (Data(body.utf8), response)
  }
}
#endif
