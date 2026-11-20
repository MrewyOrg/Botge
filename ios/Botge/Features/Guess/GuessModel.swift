import BotgeKit
import Foundation
import Observation

/// One server's Guess room: the connection, the room state, the round image and the guess.
///
/// The tab view runs ``play()`` for each ``taskID``, so a match keeps going on other tabs. After a
/// dropped connection it joins again after 1, 2 and 4 seconds, like the Activity, then offers to
/// try again.
@Observable
final class GuessModel {
  /// Automatic reconnects before the tab offers to try again.
  private static let reconnectAttempts = 3

  /// The server shown.
  let guild: SharedGuild
  /// The app-wide model.
  let app: AppModel

  /// The open room, or `nil` while choosing one.
  private(set) var room: GameRoomCode?
  /// Whether the room is reachable.
  private(set) var connection: GuessConnectionState = .joining
  /// The room's last state.
  private(set) var state: GameState?
  /// When ``state`` arrived, to turn its remaining time into a deadline.
  private(set) var received: Date = .now
  /// The signed-in user's Discord account ID.
  private(set) var player: String?
  /// The round image, once loaded.
  private(set) var image: EmoteImage?
  /// Counts wrong guesses, so the field can shake each time.
  private(set) var wrongGuesses = 0
  /// The last haptic to play.
  private(set) var haptic: HapticEvent?
  /// Changes to restart ``play()`` after a failure.
  private(set) var attempt = 0
  /// The guess being typed, at most as long as the hint, since a longer guess cannot match.
  var guess = "" {
    didSet {
      if let limit = state?.hint?.count, state?.phase == .round, guess.count > limit {
        guess = String(guess.prefix(limit))
      }
    }
  }

  /// The open connection, while connected.
  private var socket: GameConnection?
  /// The image token ``image`` belongs to.
  private var imageToken: String?
  /// Shows the match on the Lock Screen and in the Dynamic Island.
  private let liveActivity: GuessActivityController = .init()
  /// Waits before each automatic reconnect, doubling each time.
  private let reconnectDelays: [Duration]

  /// Identifies one run of ``play()``: a new room or a retry restarts it.
  var taskID: String {
    "\(guild.id)|\(room?.instanceID ?? "")|\(attempt)"
  }

  /// Whether a round is open for guesses.
  var isGuessing: Bool {
    connection == .connected && state?.phase == .round
  }

  /// Creates a model for one server.
  ///
  /// - Parameters:
  ///   - guild: The server to play in.
  ///   - app: The app-wide model.
  convenience init(guild: SharedGuild, app: AppModel) {
    self.init(guild: guild, app: app, firstReconnectDelay: .seconds(1))
  }

  /// Creates a model whose automatic reconnects wait `firstReconnectDelay`, then twice and four
  /// times as long.
  ///
  /// - Parameters:
  ///   - guild: The server to play in.
  ///   - app: The app-wide model.
  ///   - firstReconnectDelay: The wait before the first reconnect.
  init(guild: SharedGuild, app: AppModel, firstReconnectDelay: Duration) {
    self.guild = guild
    self.app = app
    reconnectDelays = (0 ..< Self.reconnectAttempts).map { firstReconnectDelay * (1 << $0) }
  }

  deinit {
    // The view's task closes the connection when the model goes away.
  }

  /// Opens `room`; the view's task then calls ``play()``.
  ///
  /// - Parameter room: The room to join.
  func open(_ room: GameRoomCode) {
    self.room = room
    connection = .joining
    state = nil
    play(.selection)
  }

  /// Leaves the room; the view's task ends and closes the connection.
  func leave() {
    room = nil
    state = nil
    image = nil
    imageToken = nil
    guess = ""
  }

  /// Tries again when the app returns to the foreground after the connection failed, since
  /// iOS closes connections of apps in the background.
  func resume() {
    if case .failed = connection, room != nil {
      retry()
    }
  }

  /// Tries again after the connection failed.
  func retry() {
    connection = .joining
    attempt += 1
  }

  /// Starts a match.
  func start() async {
    try? await socket?.send(.start)
  }

  /// Sends the typed guess and clears the field.
  func submitGuess() async {
    let text = guess.trimmingCharacters(in: .whitespacesAndNewlines)
    guard isGuessing, !text.isEmpty else {
      return
    }

    guess = ""
    try? await socket?.send(.guess(text))
  }

  /// Plays in the open room until the task is cancelled or the room cannot be reached.
  func play() async {
    guard let room, let client = app.makeGameClient() else {
      return
    }

    var failures = 0
    while !Task.isCancelled {
      do {
        let joined = try await client.join(room, guild: guild.id)
        failures = 0
        try await run(joined)
      } catch .signedOut {
        await app.signOut()
        return
      } catch {
        guard !Task.isCancelled else {
          break
        }

        if case .failed = connection {
          break
        }
        guard failures < reconnectDelays.count else {
          connection = .failed(error.message)
          break
        }

        connection = .reconnecting
        try? await Task.sleep(for: reconnectDelays[failures])
        failures += 1
      }
    }
    socket = nil
    app.isPlayingGuess = false
    await liveActivity.end()
  }

  /// Receives messages from one connection until it ends.
  ///
  /// - Parameter joined: The open connection.
  /// - Throws: ``APIError/network`` when the connection ends.
  private func run(_ joined: GameConnection) async throws(APIError) {
    socket = joined
    player = joined.userID
    defer {
      joined.close()
      socket = nil
    }
    try await withTaskCancellationHandler { () async throws(APIError) in
      while !Task.isCancelled {
        try await handle(joined.receive(), player: joined.userID)
      }
    } onCancel: {
      joined.close()
    }
  }

  /// Applies one room message.
  ///
  /// - Parameters:
  ///   - message: The message.
  ///   - player: The local player's Discord account ID.
  private func handle(_ message: GameMessage, player: String) async {
    switch message {
    case let .error(text):
      connection = .failed(text)

    case let .state(next):
      connection = .connected
      celebrate(next, player: player)
      if next.round != state?.round {
        guess = ""
      }
      state = next
      received = .now
      app.isPlayingGuess = next.phase.isPlaying
      loadImage(for: next.image)
      await liveActivity.show(
        next,
        player: player,
        received: received,
        serverName: guild.name,
        isPrivate: UserDefaults.standard.bool(forKey: PreferenceKey.appLock)
      )

    case .wrong:
      wrongGuesses += 1
      play(.failure)
    }
  }

  /// Plays a haptic when the local player wins a round or the match.
  ///
  /// - Parameters:
  ///   - next: The new state.
  ///   - player: The local player's Discord account ID.
  private func celebrate(_ next: GameState, player: String) {
    guard next.phase != state?.phase else {
      return
    }

    if next.phase == .reveal, next.winner == player {
      play(.success)
    } else if next.result == .won(player: player) {
      play(.success)
    } else if next.phase == .round {
      play(.impact)
    }
  }

  /// Loads the round image when its token changes.
  ///
  /// - Parameter token: The state's image token.
  private func loadImage(for token: String?) {
    guard token != imageToken else {
      return
    }

    imageToken = token
    image = nil
    guard let token, let url = app.makeGameClient()?.imageURL(for: token) else {
      return
    }

    Task {
      let loaded = await app.imageLoader.roundImage(at: url)
      if imageToken == token {
        image = loaded
      }
    }
  }

  /// Plays a haptic; the view checks the user's haptics setting.
  ///
  /// - Parameter kind: What happened.
  private func play(_ kind: HapticEvent.Kind) {
    haptic = HapticEvent(kind, after: haptic)
  }
}
