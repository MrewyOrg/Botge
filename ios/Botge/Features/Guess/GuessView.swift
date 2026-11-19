import BotgeKit
import SwiftUI

/// The Guess tab: choose a room, then play in it.
struct GuessView: View {
  /// Whether haptics play.
  @AppStorage(PreferenceKey.haptics) private var haptics = true
  /// The server's game state, owned by the tab view so a match survives tab switches.
  let model: GuessModel

  var body: some View {
    Group {
      if let room = model.room {
        GuessRoomView(model: model, room: room)
      } else {
        GuessStartView(model: model)
      }
    }
    .sensoryFeedback(trigger: model.haptic) { _, event in
      haptics ? event?.feedback : nil
    }
  }
}
