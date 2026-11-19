import SwiftUI

/// The guess field, kept on screen for the whole match so the keyboard stays up between rounds.
struct GuessInputBar: View {
  /// How far the field moves when it shakes after a wrong guess.
  private static let shakeDistance: CGFloat = 8
  /// How far the field moves on the shake's last swing.
  private static let shakeRebound: CGFloat = 4
  /// How long each shake step takes.
  private static let shakeStep: TimeInterval = 0.06

  /// The server's game state.
  @Bindable private var model: GuessModel
  /// Whether the field has focus.
  @FocusState private var isFocused: Bool

  var body: some View {
    HStack(spacing: Metrics.tightSpacing) {
      TextField("Guess the emote", text: $model.guess)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.send)
        .focused($isFocused)
        .onSubmit(send)
        .padding(.horizontal)
        .padding(.vertical, Metrics.compactSpacing)
        .glassEffect()
        .accessibilityIdentifier("guess.field")
      Button("Send", systemImage: "arrow.up", action: send)
        .labelStyle(.iconOnly)
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.circle)
        .controlSize(.large)
        .disabled(!model.isGuessing || model.guess.trimmingCharacters(in: .whitespaces).isEmpty)
        .accessibilityIdentifier("guess.send")
    }
    .keyframeAnimator(initialValue: CGFloat.zero, trigger: model.wrongGuesses) { content, offset in
      content.offset(x: offset)
    } keyframes: { _ in
      KeyframeTrack {
        LinearKeyframe(Self.shakeDistance, duration: Self.shakeStep)
        LinearKeyframe(-Self.shakeDistance, duration: Self.shakeStep)
        LinearKeyframe(Self.shakeRebound, duration: Self.shakeStep)
        LinearKeyframe(.zero, duration: Self.shakeStep)
      }
    }
    .padding(.horizontal)
    .padding(.bottom, Metrics.tightSpacing)
  }

  /// Creates the guess field.
  ///
  /// - Parameter model: The server's game state.
  init(model: GuessModel) {
    self.model = model
  }

  /// Sends the guess and keeps the keyboard up for the next one.
  private func send() {
    isFocused = true
    Task { await model.submitGuess() }
  }
}
