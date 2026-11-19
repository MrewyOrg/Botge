import SwiftUI

/// The logo and tagline above the login button.
struct LoginHeader: View {
  var body: some View {
    VStack(spacing: Metrics.spacing) {
      Image(.botgeLogo)
        .resizable()
        .frame(width: Metrics.logoSize, height: Metrics.logoSize)
        .clipShape(.rect(cornerRadius: Metrics.logoCornerRadius))
        .accessibilityHidden(true)
      Text("Botge")
        .font(.largeTitle.bold())
      Text("Browse, manage and play with your server's emotes.")
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
    }
  }
}
