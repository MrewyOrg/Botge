import BotgeKit
import SwiftUI

/// The app's root: the screen for the sign-in phase, behind App Lock, and the app's links.
struct RootView: View {
  /// App-wide state.
  @Environment(AppModel.self) private var model

  var body: some View {
    PhaseView()
      .appLock()
      .task { await model.restore() }
      .onOpenURL(perform: model.openAppLink)
      .animation(.default, value: model.phase)
  }
}
