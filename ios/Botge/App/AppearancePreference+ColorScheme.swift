import BotgeKit
import SwiftUI

extension AppearancePreference {
  /// The scheme passed to `preferredColorScheme`; `nil` follows the system.
  var colorScheme: ColorScheme? {
    switch self {
    case .system:
      nil

    case .light:
      .light

    case .dark:
      .dark
    }
  }

  /// The label shown in Settings.
  var title: LocalizedStringResource {
    switch self {
    case .system:
      "System"

    case .light:
      "Light"

    case .dark:
      "Dark"
    }
  }
}
