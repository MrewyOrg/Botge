#if DEBUG
import BotgeKit
import Foundation
import UIKit

/// Answers UI-test requests from fixtures, so UI tests never reach the network.
///
/// `POST /guilds` returns two fixture servers, `POST /catalog` a small catalog and
/// `POST /catalog/watch` a ticket for a watch that cannot connect offline, the settings
/// routes fixture settings (saves echo what was sent), the Guess routes a ticket for
/// ``FixtureGameSocket`` and a drawn round image, and 7TV's `gql` endpoint a page of
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
    "settings/emotes/read": #"{"sevenTvSet":null,"#
      + #""allowEveryone":false,"allowedRoles":[],"roles":\#(roles)}"#,
    "settings/border/read": #"{"color":""}"#,
    "game/join": #"{"ticket":"fixture","userId":"\#(FixtureGameSocket.player)"}"#,
    "catalog/watch": #"{"ticket":"fixture"}"#,
    "guilds": """
    {"guilds":[{"id":"100000000000000001","name":"Fixture Server","icon":null,\
    "administrator":true},{"id":"100000000000000003","name":"Second Server","icon":null,\
    "administrator":false}]}
    """,
    "catalog": """
    {"message":"Server emotes loaded.","canManageEmotes":true,"canComposeDiscovery":false,\
    "emotes":[{"name":"peepoHey","source":"7TV","image":"/7tv-cdn/emote/A/2x.webp",\
    "animated":true,"overlaying":false,"tags":["wave"],"added":true,"composeToken":"peepoHey",\
    "sevenTVId":"A"},{"name":"Kappa","source":"7TV",\
    "image":"/7tv-cdn/emote/Kappa/2x.png","animated":false,"overlaying":false,\
    "tags":[],"added":false,"composeToken":"Kappa"}]}
    """
  ]
  /// Side of the fixture round image in pixels.
  private static let imageSide = 256.0
  /// HTTP 200.
  private static let okStatus = 200
  /// Results per discovery page, so the grid scrolls.
  private static let discoveryPageSize = 60
  /// Discovery pages, so scrolling loads more.
  private static let discoveryPageCount = 5

  /// Supplies catalog revisions for the offline confirmation tests.
  private let history: FixtureCatalogHistory = .init()

  /// One discovery page: `catJAM` first on page 1, then numbered fixtures.
  ///
  /// - Parameter request: The GraphQL request, whose variables name the page.
  /// - Returns: The page's JSON.
  private static func discoveryBody(for request: URLRequest) -> String {
    let variables = request.httpBody
      .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["variables"]
      as? [String: Any]
    let page = variables?["page"] as? Int ?? 1
    let first = (page - 1) * discoveryPageSize
    let indexes = first ..< first + discoveryPageSize
    let names = indexes.map { $0 == 0 ? "catJAM" : "fixture\($0)" }
    let items = zip(indexes, names).map { index, name in
      let id = "0123456789012345678901" + String(format: "%04d", index)
      return """
      {"id":"\(id)","defaultName":"\(name)","tags":["cat"],"flags":{"animated":true,\
      "nsfw":false,"private":false,"publicListed":true,"defaultZeroWidth":false},\
      "images":[{"url":"https://cdn.7tv.app/emote/\(id)/2x.webp"}]}
      """
    }
    return #"{"data":{"emotes":{"search":{"pageCount":"# + "\(discoveryPageCount)" + #","items":["#
      + items.joined(separator: ",") + "]}}}}"
  }

  /// Answers fixture routes.
  ///
  /// - Parameter request: The request to answer.
  /// - Returns: The fixture body and a 200 response.
  /// - Throws: `URLError(.notConnectedToInternet)` for every request without a fixture.
  func data(for request: URLRequest) throws -> (Data, URLResponse) {
    if let url = request.url, url.path().contains("/game/image/") {
      return try Self.roundImage(for: url)
    }

    guard let url = request.url,
          let body = url.lastPathComponent == "gql"
          ? Self.discoveryBody(for: request)
          : history.body(route: Self.route(of: url), request: request)
            ?? Self.body(route: Self.route(of: url), request: request),
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

  /// A round image: a cat symbol drawn as a PNG.
  ///
  /// - Parameter url: The image URL.
  /// - Returns: The PNG and a 200 response.
  /// - Throws: `URLError(.cannotDecodeContentData)` when the image cannot be drawn.
  private static func roundImage(for url: URL) throws -> (Data, URLResponse) {
    let size = CGSize(width: imageSide, height: imageSide)
    let symbol = UIImage(systemName: "cat.fill")?.withTintColor(.systemOrange)
    let data = UIGraphicsImageRenderer(size: size).pngData { _ in
      symbol?.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let response = HTTPURLResponse(
      url: url,
      statusCode: okStatus,
      httpVersion: nil,
      headerFields: ["Content-Type": "image/png"]
    ) else {
      throw URLError(.cannotDecodeContentData)
    }

    return (data, response)
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
