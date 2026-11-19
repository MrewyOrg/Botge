import BotgeKit
import SwiftUI

/// A connected room: the round, recent guesses and the scoreboard, with the guess field below.
struct GuessPlayView: View {
  /// The server's game state.
  private let model: GuessModel
  /// The room state to show.
  private let state: GameState

  var body: some View {
    List {
      roundSection
      if state.phase == .round || state.phase == .reveal, !state.guesses.isEmpty {
        guessesSection
      }
      scoresSection
    }
    .contentMargins(.top, Metrics.compactSpacing, for: .scrollContent)
    .safeAreaInset(edge: .bottom) {
      if state.phase.isPlaying {
        GuessInputBar(model: model)
      }
    }
    .animation(.default, value: state.phase)
  }

  /// The round image, status, hint and start button.
  private var roundSection: some View {
    Section {
      GuessStageView(state: state, image: model.image, received: model.received)
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
      VStack(spacing: Metrics.tightSpacing) {
        if state.round > 0, state.phase != .lobby {
          Text("Round \(state.round) of \(state.rounds)")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        Text(state.status(player: model.player))
          .font(.headline)
          .multilineTextAlignment(.center)
          .accessibilityIdentifier("guess.status")
        hint
        if model.connection == .reconnecting {
          Label("Reconnecting…", systemImage: "arrow.triangle.2.circlepath")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .frame(maxWidth: .infinity)
      .listRowBackground(Color.clear)
      roomCode
      if !state.phase.isPlaying {
        startButton
      }
    }
    .listRowSeparator(.hidden)
  }

  /// The room code to share, while waiting in the lobby.
  @ViewBuilder private var roomCode: some View {
    if state.phase == .lobby, let room = model.room {
      LabeledContent("Room Code") {
        Text(room.code)
          .monospaced()
          .textSelection(.enabled)
      }
      .listRowBackground(Color.clear)
      .accessibilityIdentifier("guess.code.label")
    }
  }

  /// The masked name while the round is open, with spaced letters.
  @ViewBuilder private var hint: some View {
    if state.phase == .round, let masked = state.hint {
      Text(masked.map(String.init).joined(separator: " "))
        .font(.title2.monospaced().weight(.semibold))
        .accessibilityLabel("Hint: \(masked.replacing("_", with: " blank "))")
        .accessibilityIdentifier("guess.hint")
    }
  }

  /// The round's recent wrong guesses.
  private var guessesSection: some View {
    Section("Guesses") {
      ForEach(Array(state.guesses.enumerated()), id: \.offset) { _, entry in
        LabeledContent(GameState.name(of: entry.id, player: model.player), value: entry.text)
      }
    }
  }

  /// Players by score.
  private var scoresSection: some View {
    Section("Scores") {
      ForEach(state.players) { score in
        GuessScoreRow(
          name: GameState.name(of: score.id, player: model.player),
          score: score.score,
          rank: state.rank(of: score.id) ?? 0,
          isPlayer: score.id == model.player
        )
      }
    }
  }

  /// Starts a match from the lobby or after the last one.
  private var startButton: some View {
    Button {
      Task { await model.start() }
    } label: {
      Text(state.phase == .final ? "Play Again" : "Start Match")
        .frame(maxWidth: .infinity)
    }
    .buttonStyle(.borderedProminent)
    .controlSize(.large)
    .listRowBackground(Color.clear)
    .listRowInsets(EdgeInsets())
    .accessibilityIdentifier("guess.start")
  }

  /// Creates the play screen.
  ///
  /// - Parameters:
  ///   - model: The server's game state.
  ///   - state: The room state to show.
  init(model: GuessModel, state: GameState) {
    self.model = model
    self.state = state
  }
}
