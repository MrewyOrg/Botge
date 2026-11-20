import SwiftUI

/// Chooses between the configuration error, login, and the main tabs.
struct PhaseView: View {
  /// App-wide state.
  @Environment(AppModel.self) private var model

  var body: some View {
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
}
