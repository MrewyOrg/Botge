import BotgeKit
import SwiftUI

/// The Guess tab: choose a room, then play in it.
struct GuessView: View {
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
    .hapticFeedback(model.haptic)
  }

  /// Creates the tab.
  ///
  /// - Parameter model: The server's game state.
  init(model: GuessModel) {
    self.model = model
  }
}
