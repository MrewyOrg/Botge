import BotgeKit
import SwiftUI

/// Light, dark, or system appearance.
struct AppearanceSection: View {
  /// The appearance chosen here, applied by ``BotgeApp``.
  @AppStorage(PreferenceKey.appearance) private var appearance: AppearancePreference = .system

  var body: some View {
    Section("Appearance") {
      Picker("Theme", selection: $appearance) {
        ForEach(AppearancePreference.displayOrder, id: \.self) { option in
          Text(option.title).tag(option)
        }
      }
      .pickerStyle(.segmented)
      .accessibilityIdentifier("settings.appearance")
    }
  }
}
