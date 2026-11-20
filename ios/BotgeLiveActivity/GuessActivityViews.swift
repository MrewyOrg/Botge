import ActivityKit
import BotgeKit
import SwiftUI
import WidgetKit

/// The Lock Screen and Dynamic Island views of a running Guess match.
///
/// Follows the Live Activity guidelines: the standard 14-point Lock Screen margin, medium or
/// heavier text, the accent colour across the compact views, a live countdown even in the
/// minimal view, and a tap that opens the Guess tab. The app target compiles this file too, so
/// its tests render the views.
enum GuessActivityViews {
  /// Botge's accent colour from the asset catalog; Live Activities do not inherit the app's tint.
  static let accent: Color = .init("AccentColor")
  /// Widest the compact and minimal countdowns grow.
  private static let compactTimerWidth: CGFloat = 44
  /// The standard Lock Screen margin for Live Activities.
  private static let lockScreenMargin: CGFloat = 14
  /// Width of the Lock Screen countdown, so it stays at the trailing edge.
  private static let lockScreenTimerWidth: CGFloat = 80

  /// Opens the app on the Guess tab when the Live Activity is tapped.
  static var guessURL: URL? {
    AppLink.guess.url(scheme: AppLink.scheme(in: .main))
  }

  /// The Lock Screen presentation.
  ///
  /// - Parameters:
  ///   - attributes: The match's fixed details.
  ///   - state: The current round.
  /// - Returns: The banner view.
  static func lockScreen(
    attributes: GuessActivityAttributes,
    state: GuessActivityAttributes.ContentState
  )
    -> some View
  {
    HStack {
      VStack(alignment: .leading) {
        Text(attributes.isPrivate ? "Guess" : "Guess · \(attributes.serverName)")
          .font(.headline)
          .lineLimit(1)
        Text("Round \(state.round) of \(attributes.rounds)")
          .font(.subheadline.weight(.medium))
          .foregroundStyle(.secondary)
      }
      Spacer()
      VStack(alignment: .trailing) {
        countdown(to: state.roundEndsAt)
          .font(.title2.bold())
          .foregroundStyle(accent)
          .multilineTextAlignment(.trailing)
          .frame(maxWidth: lockScreenTimerWidth, alignment: .trailing)
        if !attributes.isPrivate {
          Text("\(state.score) pts · #\(state.rank)")
            .font(.subheadline.weight(.semibold))
        }
      }
    }
    .padding(lockScreenMargin)
    .widgetURL(guessURL)
  }

  /// The Dynamic Island presentations.
  ///
  /// - Parameters:
  ///   - attributes: The match's fixed details.
  ///   - state: The current round.
  /// - Returns: The expanded, compact and minimal views.
  static func island(
    attributes: GuessActivityAttributes,
    state: GuessActivityAttributes.ContentState
  )
    -> DynamicIsland
  {
    DynamicIsland {
      DynamicIslandExpandedRegion(.leading) {
        Text("Round \(state.round)/\(attributes.rounds)")
          .font(.headline)
      }
      DynamicIslandExpandedRegion(.trailing) {
        if !attributes.isPrivate {
          Text("\(state.score) pts · #\(state.rank)")
            .font(.headline)
        }
      }
      DynamicIslandExpandedRegion(.bottom) {
        countdown(to: state.roundEndsAt)
          .font(.title.bold())
          .foregroundStyle(accent)
          .multilineTextAlignment(.center)
      }
    } compactLeading: {
      Image(systemName: "gamecontroller.fill")
        .foregroundStyle(accent)
        .accessibilityLabel("Guess")
    } compactTrailing: {
      countdown(to: state.roundEndsAt)
        .foregroundStyle(accent)
        .frame(maxWidth: compactTimerWidth)
    } minimal: {
      countdown(to: state.roundEndsAt)
        .font(.caption2.bold())
        .foregroundStyle(accent)
        .frame(maxWidth: compactTimerWidth)
        .accessibilityLabel("Guess countdown")
    }
    .keylineTint(accent)
    .widgetURL(guessURL)
  }

  /// A countdown to `end` that stops at zero instead of running backwards.
  ///
  /// - Parameter end: When the round ends.
  /// - Returns: The countdown text.
  static func countdown(to end: Date) -> Text {
    let now = Date.now
    return Text(timerInterval: now ... max(now, end), countsDown: true)
      .monospacedDigit()
  }
}
