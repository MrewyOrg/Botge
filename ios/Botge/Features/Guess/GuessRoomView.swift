import BotgeKit
import SwiftUI

/// A Guess room: the round, the scoreboard, the guess field and the room's controls.
struct GuessRoomView: View {
  /// The server's game state.
  private let model: GuessModel
  /// The open room.
  private let room: GameRoomCode
  /// Whether the leave confirmation is showing.
  @State private var isConfirmingLeave = false

  var body: some View {
    content
      .navigationTitle("Guess")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          leaveButton
        }
        ToolbarItem(placement: .principal) {
          Text("Room \(room.code)")
            .font(.headline)
            .accessibilityIdentifier("guess.room")
        }
        ToolbarItem(placement: .primaryAction) {
          ShareLink(
            item: String(
              localized: "Join my Botge Guess room in \(model.guild.name): \(room.code)"
            ),
            preview: SharePreview("Botge Guess room \(room.code)")
          ) {
            Label("Invite", systemImage: "square.and.arrow.up")
          }
        }
      }
  }

  /// Leaves the room, asking first while a match is being played.
  private var leaveButton: some View {
    Button("Leave") {
      if model.state?.phase.isPlaying == true {
        isConfirmingLeave = true
      } else {
        model.leave()
      }
    }
    .accessibilityIdentifier("guess.leave")
    .confirmationDialog("Leave the match?", isPresented: $isConfirmingLeave) {
      Button("Leave Match", role: .destructive) {
        model.leave()
      }
    } message: {
      Text("Your score stays in this match, but you can't keep playing it.")
    }
  }

  /// The room, or the joining or failure state.
  @ViewBuilder private var content: some View {
    switch model.connection {
    case let .failed(message):
      ContentUnavailableView {
        Label("Can't Reach the Room", systemImage: "wifi.exclamationmark")
      } description: {
        Text(message)
      } actions: {
        Button("Try Again") {
          model.retry()
        }
        .buttonStyle(.borderedProminent)
      }

    case .connected, .joining, .reconnecting:
      if let state = model.state {
        GuessPlayView(model: model, state: state)
      } else {
        ProgressView("Joining Room \(room.code)")
      }
    }
  }

  /// Creates the room screen.
  ///
  /// - Parameters:
  ///   - model: The server's game state.
  ///   - room: The open room.
  init(model: GuessModel, room: GameRoomCode) {
    self.model = model
    self.room = room
  }
}
