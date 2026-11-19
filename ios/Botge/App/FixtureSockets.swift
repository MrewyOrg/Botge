#if DEBUG
import BotgeKit
import Foundation

/// Opens a scripted Guess room for `game/ws` and real connections, which fail offline, for
/// everything else.
nonisolated struct FixtureSockets: SocketConnecting {
  /// Opens the other connections.
  private let session: URLSession = .init(configuration: .ephemeral)

  /// Connects to `url`.
  ///
  /// - Parameter url: The WebSocket URL.
  /// - Returns: The fixture room or a real connection.
  func connect(to url: URL) -> any MessageSocket {
    if url.path().hasSuffix("/game/ws") {
      FixtureGameSocket()
    } else {
      session.connect(to: url)
    }
  }
}
#endif
