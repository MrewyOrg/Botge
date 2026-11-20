import ActivityKit
import BotgeKit
import Foundation

/// Starts, updates and ends the Guess Live Activity on this device; no push server is used.
///
/// The activity runs from the first round until the match ends or the player leaves. It is
/// skipped when the user turned Live Activities off for Botge.
final class GuessActivityController {
  /// How long after the round's deadline an activity counts as stale, in seconds, for when the
  /// app stops updating it.
  private nonisolated static let staleMargin: TimeInterval = 30

  /// The running activity's ID, if any.
  private var activityID: String?
  /// The last content sent, so unchanged states cause no update.
  private var content: GuessActivityAttributes.ContentState?
  /// Whether the running activity started private; its fixed attributes cannot change.
  private var isRunningPrivate = false

  deinit {
    // The view ends the activity before the controller goes away.
  }

  /// Shows `state` in the Live Activity, starting or ending it as the match requires.
  ///
  /// - Parameters:
  ///   - state: The room state.
  ///   - player: The local player's Discord account ID.
  ///   - received: When the state arrived.
  ///   - serverName: The server's name for the activity's title.
  ///   - isPrivate: Whether App Lock is on; the server name and score then stay in the app. A
  ///     running activity keeps the setting it started with until the match ends.
  func show(
    _ state: GameState,
    player: String,
    received: Date,
    serverName: String,
    isPrivate: Bool
  )
    async
  {
    guard var next = GuessActivityAttributes.ContentState(
      state: state,
      player: player,
      received: received
    ) else {
      if !state.phase.isPlaying {
        await end()
      }
      return
    }

    if activityID == nil {
      isRunningPrivate = isPrivate
    }
    if isRunningPrivate {
      next.score = 0
      next.rank = 0
    }
    guard next != content else {
      return
    }

    content = next
    if let activityID {
      await Self.update(activityID, to: next)
    } else if ActivityAuthorizationInfo().areActivitiesEnabled {
      let attributes = GuessActivityAttributes(
        serverName: serverName,
        rounds: state.rounds,
        isPrivate: isRunningPrivate
      )
      let initial = ActivityContent(state: next, staleDate: Self.staleDate(for: next))
      activityID = try? Activity.request(attributes: attributes, content: initial, pushType: nil).id
    }
  }

  /// Ends the Live Activity and removes it from the Lock Screen.
  func end() async {
    content = nil
    guard let running = activityID else {
      return
    }

    activityID = nil
    await Self.end(running)
  }

  /// Ends activities left over from an earlier launch, such as after the app was closed during a
  /// match.
  @concurrent
  static func endLeftovers() async {
    for activity in Activity<GuessActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }

  /// When content stops being current if the app no longer updates it.
  ///
  /// - Parameter state: The content.
  /// - Returns: Shortly after the round's deadline.
  private nonisolated static func staleDate(for state: GuessActivityAttributes
    .ContentState)
    -> Date
  {
    state.roundEndsAt.addingTimeInterval(staleMargin)
  }

  /// Finds a running activity by ID.
  ///
  /// - Parameter id: The activity ID.
  /// - Returns: The activity, or `nil` when the system already ended it.
  private nonisolated static func activity(_ id: String) -> Activity<GuessActivityAttributes>? {
    Activity<GuessActivityAttributes>.activities.first { $0.id == id }
  }

  /// Updates a running activity off the main actor.
  ///
  /// - Parameters:
  ///   - id: The activity ID.
  ///   - state: The new content.
  @concurrent
  private static func update(_ id: String, to state: GuessActivityAttributes.ContentState) async {
    await activity(id)?.update(ActivityContent(state: state, staleDate: staleDate(for: state)))
  }

  /// Ends a running activity off the main actor and removes it at once.
  ///
  /// - Parameter id: The activity ID.
  @concurrent
  private static func end(_ id: String) async {
    await activity(id)?.end(nil, dismissalPolicy: .immediate)
  }
}
