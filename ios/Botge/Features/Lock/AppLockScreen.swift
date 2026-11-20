import SwiftUI

/// The opaque screen shown while Botge is locked.
struct AppLockScreen: View {
  /// The unlock method's SF Symbol, such as `faceid`.
  let symbol: String
  /// Whether the system prompt is showing.
  let isAuthenticating: Bool
  /// Asks the owner to authenticate.
  let unlock: () -> Void

  var body: some View {
    ZStack {
      Rectangle()
        .fill(.background)
        .ignoresSafeArea()
      VStack(spacing: Metrics.spacing) {
        Image(systemName: "lock.fill")
          .font(.largeTitle)
          .accessibilityHidden(true)
        Text("Botge Is Locked")
          .font(.title2.bold())
        Button("Unlock", systemImage: symbol, action: unlock)
          .buttonStyle(.glassProminent)
          .disabled(isAuthenticating)
          .accessibilityIdentifier("lock.unlock")
      }
    }
  }
}
