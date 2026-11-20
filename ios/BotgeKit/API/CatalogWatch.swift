import Foundation

/// Keeps a catalog watch connection open and reports when the server's catalog may have changed.
///
/// Each connection presents a fresh one-use ticket. When a connection fails or the server ends
/// it (at the latest after an hour), the watch reconnects after a delay that doubles from one
/// second up to thirty, and resets once a connection is accepted. Messages carry no catalog
/// data; the caller reloads the catalog.
public struct CatalogWatch: Sendable {
  /// Waits for a duration and throws when the task is cancelled.
  public typealias Pause = @Sendable (Duration) async throws -> Void

  /// The first reconnect delay.
  public static let initialDelay: Duration = .seconds(1)
  /// The longest reconnect delay.
  public static let maximumDelay: Duration = .seconds(maximumDelaySeconds)
  /// The longest reconnect delay in seconds.
  static let maximumDelaySeconds = 30
  /// How much each failed attempt multiplies the delay.
  static let backoffFactor = 2

  /// Issues tickets.
  private let api: BotgeAPI
  /// Opens connections.
  private let connector: any SocketConnecting
  /// Waits between attempts; tests skip the wait.
  private let pause: Pause

  /// Creates a watch.
  ///
  /// - Parameters:
  ///   - api: The client that issues watch tickets.
  ///   - connector: Opens WebSocket connections.
  ///   - pause: Waits between attempts; throws when the task is cancelled.
  public init(
    api: BotgeAPI,
    connector: any SocketConnecting,
    pause: @escaping Pause = Self.sleep
  ) {
    self.api = api
    self.connector = connector
    self.pause = pause
  }

  /// Sleeps for `duration` on the task clock.
  ///
  /// - Parameter duration: How long to wait.
  /// - Throws: `CancellationError` when the task is cancelled.
  public static func sleep(_ duration: Duration) async throws {
    try await Task.sleep(for: duration)
  }

  /// Watches `guild` until the task is cancelled or the login is rejected.
  ///
  /// - Parameters:
  ///   - guild: The Discord server ID.
  ///   - onChange: Called after each change notice.
  /// - Throws: ``APIError/signedOut`` when the login is rejected; returns normally when
  ///   cancelled.
  public func run(guild: String, onChange: @escaping @Sendable () async -> Void)
    async throws(APIError)
  {
    var delay = Self.initialDelay
    var isReconnecting = false
    while !Task.isCancelled {
      do {
        let accepted = try await session(
          guild: guild,
          catchesUp: isReconnecting,
          onChange: onChange
        )
        if accepted {
          delay = Self.initialDelay
        }
      } catch .signedOut {
        throw .signedOut
      } catch {
        // Failed tickets and connections are retried after the delay.
      }
      // Changes made while disconnected are missed, so every later session catches up.
      isReconnecting = true
      guard await (try? pause(delay)) != nil else {
        return
      }

      delay = min(delay * Self.backoffFactor, Self.maximumDelay)
    }
  }

  /// Runs one connection until it ends.
  ///
  /// - Parameters:
  ///   - guild: The Discord server ID.
  ///   - catchesUp: Whether to report a change once the server accepts the ticket, because
  ///     changes made since the last connection were missed.
  ///   - onChange: Called after each change notice.
  /// - Returns: Whether the server accepted the ticket before the connection ended.
  /// - Throws: ``APIError`` when no ticket could be issued.
  private func session(
    guild: String,
    catchesUp: Bool,
    onChange: @Sendable () async -> Void
  )
    async throws(APIError) -> Bool
  {
    let ticket = try await api.watchTicket(guild: guild)
    guard let url = await api.socketURL("catalog/ws") else {
      throw .malformedResponse
    }

    let socket = connector.connect(to: url)
    defer { socket.close() }
    var accepted = false
    await withTaskCancellationHandler {
      do {
        try await socket.send(#"{"type":"watch","ticket":"\#(ticket)"}"#)
        while !Task.isCancelled {
          let text = try await socket.receive()
          let message = try JSONDecoder().decode(WatchMessage.self, from: Data(text.utf8))
          switch message.type {
          case "watching":
            accepted = true
            if catchesUp {
              await onChange()
            }

          case "changed":
            await onChange()

          default:
            return
          }
        }
      } catch {
        // The connection ended; the caller decides whether to reconnect.
      }
    } onCancel: {
      socket.close()
    }
    return accepted
  }
}
