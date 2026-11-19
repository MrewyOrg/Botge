import ActivityKit
import BotgeKit
import SwiftUI
import WidgetKit

/// Lock Screen and Dynamic Island presentation of a running Guess match.
struct GuessLiveActivity: Widget {
  private static let compactTimerWidth: CGFloat = 44

  var body: some WidgetConfiguration {
    ActivityConfiguration(for: GuessActivityAttributes.self) { context in
      HStack {
        VStack(alignment: .leading) {
          Text("Guess · \(context.attributes.serverName)")
            .font(.headline)
          Text("Round \(context.state.round) of \(context.attributes.rounds)")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        Spacer()
        VStack(alignment: .trailing) {
          Text(timerInterval: Date.now ... context.state.roundEndsAt, countsDown: true)
            .monospacedDigit()
            .font(.title2.bold())
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
          Text(timerInterval: Date.now ... context.state.roundEndsAt, countsDown: true)
            .monospacedDigit()
            .font(.title.bold())
        }
      } compactLeading: {
        Image(systemName: "gamecontroller.fill")
          .accessibilityLabel("Guess")
      } compactTrailing: {
        Text(timerInterval: Date.now ... context.state.roundEndsAt, countsDown: true)
          .monospacedDigit()
          .frame(maxWidth: Self.compactTimerWidth)
      } minimal: {
        Image(systemName: "gamecontroller.fill")
          .accessibilityLabel("Guess")
      }
    }
  }
}
