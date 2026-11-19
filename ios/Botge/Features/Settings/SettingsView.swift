import BotgeKit
import SwiftUI

/// App settings: account, appearance, App Lock, haptics and motion, storage, and legal.
struct SettingsView: View {
  /// Performs logout.
  @Environment(AppModel.self) private var model
  /// Whether the logout confirmation is showing.
  @State private var isConfirmingSignOut = false

  var body: some View {
    NavigationStack {
      Form {
        AppearanceSection()
        SecuritySection()
        MotionSection()
        LinksSection()
        Section {
          Button(role: .destructive) {
            isConfirmingSignOut = true
          } label: {
            Label("Log Out of Discord", systemImage: "rectangle.portrait.and.arrow.right")
          }
          .accessibilityIdentifier("settings.logout")
        }
      }
      .navigationTitle("Settings")
      .confirmationDialog("Log out of Discord?", isPresented: $isConfirmingSignOut) {
        Button("Log Out", role: .destructive) {
          Task { await model.signOut() }
        }
      } message: {
        Text("Botge forgets your Discord login on this device.")
      }
    }
  }
}
