import BotgeKit
import Foundation

/// Where the Emotes grid takes its emotes from.
enum EmotesSource: Hashable {
  /// 7TV's public rankings.
  case discovery(DiscoveryMode)
  /// The server's catalog.
  case server

  /// The choices in the source picker, in order.
  static let choices: [Self] = [.server, .discovery(.trending), .discovery(.top)]

  /// The picker label.
  var title: LocalizedStringResource {
    switch self {
    case .discovery(.top):
      "Top"

    case .discovery(.trending):
      "Trending"

    case .server:
      "Server"
    }
  }
}
