import AuthenticationServices
import BotgeKit
import SwiftUI

/// Discord login through the system sheet, which keeps the Discord password out of the app.
struct LoginView: View {
  /// Runs the login and holds its failure.
  @Environment(AppModel.self) private var model
  /// Presents the system login sheet.
  @Environment(\.webAuthenticationSession) private var webAuthenticationSession

  var body: some View {
    VStack(spacing: Metrics.spacing) {
      Spacer()
      LoginHeader()
      Spacer()
      if let failure = model.loginFailure {
        Label {
          Text(failure.message)
        } icon: {
          Image(systemName: "exclamationmark.triangle")
        }
        .font(.callout)
        .foregroundStyle(.red)
        .multilineTextAlignment(.center)
        .accessibilityIdentifier("login.error")
      }
      Button {
        Task { await signIn() }
      } label: {
        Label(buttonTitle, systemImage: "person.badge.key")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(model.isSigningIn)
      .accessibilityIdentifier("login.discord")
      Text("Botge only asks Discord for your username and avatar.")
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
    .padding()
  }

  /// Offers a retry after a retryable failure.
  private var buttonTitle: LocalizedStringResource {
    if model.loginFailure?.isRetryable == true {
      "Try Again"
    } else {
      "Continue with Discord"
    }
  }

  /// Starts the login with the system sheet as the browser.
  private func signIn() async {
    await model.signIn { url, scheme in
      try await webAuthenticationSession.authenticate(
        using: url,
        callback: .customScheme(scheme),
        preferredBrowserSession: .ephemeral,
        additionalHeaderFields: [:]
      )
    }
  }
}
