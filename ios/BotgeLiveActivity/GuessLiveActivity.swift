import ActivityKit
import BotgeKit
import SwiftUI
import WidgetKit

/// The Guess match Live Activity on the Lock Screen and in the Dynamic Island.
///
/// The views live in ``GuessActivityViews``, which the app tests render; this type only connects
/// them to ActivityKit, whose contexts only the system creates.
struct GuessLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(
      for: GuessActivityAttributes.self,
      content: Self.lockScreen,
      dynamicIsland: Self.island
    )
  }

  /// The Lock Screen view for a running activity.
  ///
  /// - Parameter context: The activity's attributes and current state.
  /// - Returns: The banner view.
  static func lockScreen(_ context: ActivityViewContext<GuessActivityAttributes>) -> some View {
    GuessActivityViews.lockScreen(attributes: context.attributes, state: context.state)
  }

  /// The Dynamic Island for a running activity.
  ///
  /// - Parameter context: The activity's attributes and current state.
  /// - Returns: The expanded, compact and minimal views.
  static func island(_ context: ActivityViewContext<GuessActivityAttributes>) -> DynamicIsland {
    GuessActivityViews.island(attributes: context.attributes, state: context.state)
  }
}
