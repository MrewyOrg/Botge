import BotgeKit
import SwiftUI

/// Creates a new Guess room or joins one by its code.
struct GuessStartView: View {
  /// The server's game state.
  private let model: GuessModel
  /// The typed room code.
  @State private var code = ""

  var body: some View {
    Form {
      Section {
        Button {
          model.open(.random())
        } label: {
          Label("Create a Room", systemImage: "plus.circle.fill")
        }
        .accessibilityIdentifier("guess.create")
      } footer: {
        Text(
          "Botge shows blurred emotes from \(model.guild.name). Name them in time."
        )
      }
      Section {
        TextField("Room Code", text: $code)
          .textInputAutocapitalization(.characters)
          .autocorrectionDisabled()
          .submitLabel(.join)
          .onSubmit(join)
          .accessibilityIdentifier("guess.code")
        Button("Join Room", action: join)
          .disabled(GameRoomCode(code) == nil)
          .accessibilityIdentifier("guess.join")
      } header: {
        Text("Join a Room")
      } footer: {
        Text(
          "Ask a friend in this server for their room code. Discord Activity games are separate."
        )
      }
    }
    .navigationTitle("Guess")
  }

  /// Creates the start screen.
  ///
  /// - Parameter model: The server's game state.
  init(model: GuessModel) {
    self.model = model
  }

  /// Joins the typed room, if the code is valid.
  private func join() {
    if let room = GameRoomCode(code) {
      model.open(room)
    }
  }
}
