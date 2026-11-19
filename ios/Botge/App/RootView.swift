import BotgeKit
import SwiftUI

/// Chooses between the configuration error, login, and the main tabs, behind App Lock.
struct RootView: View {
  /// App-wide state.
  @Environment(AppModel.self) private var model

  var body: some View {
    Group {
      switch model.phase {
      case let .misconfigured(error):
        ConfigurationErrorView(error: error)

      case .restoring:
        Color.clear

      case .signedOut:
        LoginView()

      case .signedIn:
        MainTabView()
      }
    }
    .appLock()
    .task { await model.restore() }
    .onOpenURL { url in
      let scheme = Bundle.main.object(forInfoDictionaryKey: AppLink.schemeKey) as? String ?? ""
      switch AppLink(url: url, scheme: scheme) {
      case .emotes:
        model.selectedTab = .emotes

      case .guess:
        model.selectedTab = .guess

      case nil:
        break
      }
    }
    .animation(.default, value: model.phase)
  }
}
