#if DEBUG
import BotgeKit
import Foundation

/// Answers UI-test requests from fixtures, so UI tests never reach the network.
///
/// `POST /guilds` returns one fixture server, `POST /catalog` a small catalog, the settings
/// routes fixture settings (saves echo what was sent) and 7TV's `gql` endpoint a page of
/// discovery results, long enough to scroll; every other request, including images, fails as
/// if offline.
struct FixtureTransport: HTTPTransport {
  /// The path prefix of app API routes.
  private static let routePrefix = "/app/v1/"
  /// Joinable voice channels.
  private static let channels = #"[{"id":"200000000000000001","name":"Lounge"}]"#
  /// Roles for the manager picker.
  private static let roles = #"[{"id":"300000000000000001","name":"Moderators"}]"#

  /// Fixture bodies by app API route.
  private static let bodies: [String: String] = [
    "settings": #"{"voice":{"channelId":null,"statusEnabled":false,"statusEmoji":null},"#
      + #""channels":\#(channels)}"#,
    "settings/emotes/read": #"{"sevenTvSet":null,"bttvTwitchId":null,"ffzChannel":null,"#
      + #""allowEveryone":false,"allowedRoles":[],"roles":\#(roles)}"#,
    "settings/border/read": #"{"color":""}"#,
    "guilds": """
    {"guilds":[{"id":"100000000000000001","name":"Fixture Server","icon":null,\
    "administrator":true}]}
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
  /// Discovery results after `catJAM`, so the grid scrolls.
  private static let extraDiscoveryCount = 59

  /// One discovery page: `catJAM`, then numbered fixtures.
  private static var discoveryBody: String {
    let names = ["catJAM"] + (1 ... extraDiscoveryCount).map { "fixture\($0)" }
    let items = names.enumerated().map { index, name in
      let id = "0123456789012345678901" + String(format: "%04d", index)
      return """
      {"id":"\(id)","defaultName":"\(name)","tags":["cat"],"flags":{"animated":true,\
      "nsfw":false,"private":false,"publicListed":true,"defaultZeroWidth":false},\
      "images":[{"url":"https://cdn.7tv.app/emote/\(id)/2x.webp"}]}
      """
    }
    return #"{"data":{"emotes":{"search":{"pageCount":1,"items":["#
      + items.joined(separator: ",") + "]}}}}"
  }

  /// Answers fixture routes.
  ///
  /// - Parameter request: The request to answer.
  /// - Returns: The fixture body and a 200 response.
  /// - Throws: `URLError(.notConnectedToInternet)` for every request without a fixture.
  func data(for request: URLRequest) throws -> (Data, URLResponse) {
    guard let url = request.url,
          let body = url.lastPathComponent == "gql"
          ? Self.discoveryBody
          : Self.body(route: Self.route(of: url), request: request),
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

  /// The app API route of `url`, such as `settings/emotes/read`.
  ///
  /// - Parameter url: A request URL.
  /// - Returns: The path after `/app/v1/`, or the whole path for other URLs.
  private static func route(of url: URL) -> String {
    let path = url.path()
    guard let range = path.range(of: routePrefix) else {
      return path
    }

    return String(path[range.upperBound...])
  }

  /// The fixture answer for `route`; settings saves echo the sent values.
  ///
  /// - Parameters:
  ///   - route: The app API route.
  ///   - request: The request, whose JSON body a save echoes.
  /// - Returns: The answer body, or `nil` when the route has no fixture.
  private static func body(route: String, request: URLRequest) -> String? {
    let sent = request.httpBody
      .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    let field: (String) -> String? = { key in
      sent[key]
        .flatMap { try? JSONSerialization.data(withJSONObject: $0, options: .fragmentsAllowed) }
        .flatMap { String(bytes: $0, encoding: .utf8) }
    }
    switch route {
    case "settings/border":
      return field("color").map { #"{"color":\#($0)}"# }

    case "settings/emotes":
      return field("emotes").map { emotes in
        String(emotes.dropLast()) + #","roles":\#(roles)}"#
      }

    case "settings/voice":
      return field("voice").map { #"{"voice":\#($0),"channels":\#(channels)}"# }

    default:
      return bodies[route]
    }
  }
}
#endif
