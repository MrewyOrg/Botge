import BotgeKit
import SwiftUI

/// The voice channel Botge stays in and the status it sets there.
struct VoiceSection: View {
  /// The server's settings state.
  @Bindable private var model: ServerModel

  var body: some View {
    Section {
      Picker(selection: $model.voiceDraft.channelID) {
        Text("Stay Disconnected").tag(String?.none)
        ForEach(model.voice?.choices ?? []) { channel in
          Text(channel.name).tag(Optional(channel.id))
        }
      } label: {
        Label("Channel", systemImage: "speaker.wave.2")
      }
      .pickerStyle(.navigationLink)
      .accessibilityIdentifier("server.voice.channel")
      Toggle(isOn: $model.voiceDraft.isStatusEnabled) {
        Label("Channel Status", systemImage: "text.bubble")
      }
      .accessibilityIdentifier("server.voice.status.enabled")
      LabeledContent {
        TextField("Status", text: $model.voiceDraft.status.orEmpty, prompt: Text("🎮 Gaming"))
          .multilineTextAlignment(.trailing)
      } label: {
        Label("Status Text", systemImage: "textformat")
      }
      .disabled(!model.voiceDraft.isStatusEnabled)
      .accessibilityIdentifier("server.voice.status")
    } header: {
      Text("Voice")
    } footer: {
      if model.voiceDraft.isStatusValid {
        Text("Botge applies voice changes shortly after you save.")
      } else {
        Text("The status can't be longer than \(VoiceSettings.maxStatusBytes) bytes.")
          .foregroundStyle(.red)
      }
    }
  }

  /// Creates the section.
  ///
  /// - Parameter model: The server's settings state.
  init(model: ServerModel) {
    self.model = model
  }
}
