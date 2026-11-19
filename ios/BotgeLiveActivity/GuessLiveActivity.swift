import ActivityKit
import BotgeKit
import SwiftUI
import WidgetKit

/// Lock Screen and Dynamic Island presentation of a running Guess match.
///
/// Follows the Live Activity guidelines: the standard 14-point Lock Screen margin, medium or
/// heavier text, the accent colour across the compact views, a live countdown even in the
/// minimal view, and a tap that opens the Guess tab.
struct GuessLiveActivity: Widget {
  /// Botge's accent colour from the extension's asset catalog; Live Activities do not inherit
  /// the app's tint.
  private static let accent: Color = .init("AccentColor")
  /// Widest the compact and minimal countdowns grow.
  private static let compactTimerWidth: CGFloat = 44
  /// The standard Lock Screen margin for Live Activities.
  private static let lockScreenMargin: CGFloat = 14
  /// Width of the Lock Screen countdown, so it stays at the trailing edge.
  private static let lockScreenTimerWidth: CGFloat = 80
  /// Opens the app on the Guess tab when the Live Activity is tapped.
  private static let guessURL = AppLink.guess.url(
    scheme: Bundle.main.object(forInfoDictionaryKey: AppLink.schemeKey) as? String ?? ""
  )

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: GuessActivityAttributes.self) { context in
      HStack {
        VStack(alignment: .leading) {
          Text("Guess · \(context.attributes.serverName)")
            .font(.headline)
            .lineLimit(1)
          Text("Round \(context.state.round) of \(context.attributes.rounds)")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.secondary)
        }
        Spacer()
        VStack(alignment: .trailing) {
          Self.countdown(to: context.state.roundEndsAt)
            .font(.title2.bold())
            .foregroundStyle(Self.accent)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: Self.lockScreenTimerWidth, alignment: .trailing)
          Text("\(context.state.score) pts · #\(context.state.rank)")
            .font(.subheadline.weight(.semibold))
        }
      }
      .padding(Self.lockScreenMargin)
      .widgetURL(Self.guessURL)
    } dynamicIsland: { context in
      Self.island(context)
    }
  }

  /// The Dynamic Island presentations.
  ///
  /// - Parameter context: The activity's attributes and current state.
  /// - Returns: The expanded, compact and minimal views.
  private static func island(
    _ context: ActivityViewContext<GuessActivityAttributes>
  )
    -> DynamicIsland
  {
    DynamicIsland {
      DynamicIslandExpandedRegion(.leading) {
        Text("Round \(context.state.round)/\(context.attributes.rounds)")
          .font(.headline)
      }
      DynamicIslandExpandedRegion(.trailing) {
        Text("\(context.state.score) pts · #\(context.state.rank)")
          .font(.headline)
      }
      DynamicIslandExpandedRegion(.bottom) {
        Self.countdown(to: context.state.roundEndsAt)
          .font(.title.bold())
          .foregroundStyle(Self.accent)
          .multilineTextAlignment(.center)
      }
    } compactLeading: {
      Image(systemName: "gamecontroller.fill")
        .foregroundStyle(Self.accent)
        .accessibilityLabel("Guess")
    } compactTrailing: {
      Self.countdown(to: context.state.roundEndsAt)
        .foregroundStyle(Self.accent)
        .frame(maxWidth: Self.compactTimerWidth)
    } minimal: {
      Self.countdown(to: context.state.roundEndsAt)
        .font(.caption2.bold())
        .foregroundStyle(Self.accent)
        .frame(maxWidth: Self.compactTimerWidth)
        .accessibilityLabel("Guess countdown")
    }
    .keylineTint(accent)
    .widgetURL(guessURL)
  }

  /// A countdown to `end` that stops at zero instead of running backwards.
  ///
  /// - Parameter end: When the round ends.
  /// - Returns: The countdown text.
  private static func countdown(to end: Date) -> Text {
    let now = Date.now
    return Text(timerInterval: now ... max(now, end), countsDown: true)
      .monospacedDigit()
  }
}
