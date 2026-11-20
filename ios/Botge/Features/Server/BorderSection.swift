import BotgeKit
import SwiftUI

/// The user's own emote border, which applies in every server.
struct BorderSection: View {
  /// The server's settings state.
  @Bindable private var model: ServerModel

  var body: some View {
    Section {
      Toggle(isOn: $model.isBorderEnabled) {
        Label("Emote Border", systemImage: "square.dashed")
      }
      .accessibilityIdentifier("server.border.enabled")
      ColorPicker(selection: color, supportsOpacity: false) {
        Label("Color", systemImage: "paintpalette")
      }
      .disabled(!model.isBorderEnabled)
      .accessibilityIdentifier("server.border.color")
    } header: {
      Text("Your Emote Border")
    } footer: {
      Text("Botge draws this border around emotes it posts for you, in every server.")
    }
  }

  /// The picked color as a SwiftUI color.
  private var color: Binding<Color> {
    Binding {
      model.borderPick.color
    } set: { color in
      model.borderPick = BorderColor(color)
    }
  }

  /// Creates the section.
  ///
  /// - Parameter model: The server's settings state.
  init(model: ServerModel) {
    self.model = model
  }
}
