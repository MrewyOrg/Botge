import SwiftUI
import WidgetKit

/// The widget extension; it only hosts the Guess game Live Activity.
@main
struct BotgeLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    GuessLiveActivity()
  }
}
