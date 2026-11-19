import SwiftUI

/// The opaque screen shown while Botge is locked.
struct AppLockScreen: View {
  let isAuthenticating: Bool
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
        Button("Unlock", systemImage: "faceid", action: unlock)
          .buttonStyle(.glassProminent)
          .disabled(isAuthenticating)
          .accessibilityIdentifier("lock.unlock")
      }
    }
  }
}
