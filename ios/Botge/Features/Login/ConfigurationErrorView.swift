import BotgeKit
import SwiftUI

/// Explains a build without deployment values; shown instead of the login screen.
struct ConfigurationErrorView: View {
  let error: ConfigurationError

  var body: some View {
    ContentUnavailableView {
      Label("Botge Isn't Configured", systemImage: "wrench.and.screwdriver")
    } description: {
      Text(detail)
    }
  }

  private var detail: LocalizedStringResource {
    switch error {
    case .missingAPIBaseURL:
      "Set BOTGE_API_BASE_URL in ios/Config/Botge.local.xcconfig and rebuild."

    case .invalidAPIBaseURL:
      "BOTGE_API_BASE_URL must be an HTTPS URL. Write https:/$()/ in the xcconfig file."

    case .missingApplicationID:
      "Set DISCORD_APPLICATION_ID in ios/Config/Botge.local.xcconfig and rebuild."

    case .invalidApplicationID:
      "DISCORD_APPLICATION_ID must be the numeric Discord application ID."
    }
  }
}
