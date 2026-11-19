import ActivityKit
import BotgeKit
import SwiftUI
import WidgetKit

/// Lock Screen and Dynamic Island presentation of a running Guess match.
struct GuessLiveActivity: Widget {
  private static let compactTimerWidth: CGFloat = 44
  /// Width of the Lock Screen countdown, so it stays at the trailing edge.
  private static let lockScreenTimerWidth: CGFloat = 80

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: GuessActivityAttributes.self) { context in
      HStack {
        VStack(alignment: .leading) {
          Text("Guess · \(context.attributes.serverName)")
            .font(.headline)
            .lineLimit(1)
          Text("Round \(context.state.round) of \(context.attributes.rounds)")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        Spacer()
        VStack(alignment: .trailing) {
          Text(timerInterval: Self.countdown(to: context.state.roundEndsAt), countsDown: true)
            .monospacedDigit()
            .font(.title2.bold())
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: Self.lockScreenTimerWidth, alignment: .trailing)
          Text("\(context.state.score) pts · #\(context.state.rank)")
            .font(.caption)
        }
      }
      .padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("Round \(context.state.round)/\(context.attributes.rounds)")
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(context.state.score) pts")
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(timerInterval: Self.countdown(to: context.state.roundEndsAt), countsDown: true)
            .monospacedDigit()
            .font(.title.bold())
            .multilineTextAlignment(.center)
        }
      } compactLeading: {
        Image(systemName: "gamecontroller.fill")
          .accessibilityLabel("Guess")
      } compactTrailing: {
        Text(timerInterval: Self.countdown(to: context.state.roundEndsAt), countsDown: true)
          .monospacedDigit()
          .frame(maxWidth: Self.compactTimerWidth)
      } minimal: {
        Image(systemName: "gamecontroller.fill")
          .accessibilityLabel("Guess")
      }
    }
  }

  /// The time from now until `end`, empty once `end` has passed.
  ///
  /// - Parameter end: When the round ends.
  /// - Returns: A range that never runs backwards.
  private static func countdown(to end: Date) -> ClosedRange<Date> {
    let now = Date.now
    return now ... max(now, end)
  }
}
