import BotgeKit
import SwiftUI

/// The round image, blurred less as the round runs out, with the round's countdown bar.
struct GuessStageView: View {
  /// Side of the square image area.
  private static let size: CGFloat = 200
  /// The largest symbol is this fraction of the image area.
  private static let symbolFraction: CGFloat = 2
  /// Corner radius of the image area.
  private static let cornerRadius: CGFloat = 24
  /// The shortest time between blur updates.
  private static let blurInterval: TimeInterval = 1 / blurUpdatesPerSecond
  /// Blur updates per second at most; the blur changes slowly, so this looks smooth.
  private static let blurUpdatesPerSecond: TimeInterval = 30

  /// Size of the lobby and trophy symbols, growing with the text size.
  @ScaledMetric private var symbolSize: CGFloat = 64
  /// Whether the system Auto-Play Animated Images setting is on.
  @Environment(\.accessibilityPlayAnimatedImages) private var playsAnimatedImages

  /// The room state.
  let state: GameState
  /// The round image, once loaded.
  let image: EmoteImage?
  /// When the state arrived.
  let received: Date

  var body: some View {
    VStack(spacing: Metrics.compactSpacing) {
      picture
        .frame(width: Self.size, height: Self.size)
        .background(.fill.tertiary, in: .rect(cornerRadius: Self.cornerRadius))
        .clipShape(.rect(cornerRadius: Self.cornerRadius))
      if state.phase == .round, let deadline = state.deadline(from: received) {
        ProgressView(timerInterval: received ... deadline, countsDown: true) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .frame(width: Self.size)
        .accessibilityLabel("Time left")
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, Metrics.compactSpacing)
  }

  /// The image, a waiting indicator, or the game symbol.
  @ViewBuilder private var picture: some View {
    switch state.phase {
    case .round:
      if let image, let deadline = state.deadline(from: received) {
        TimelineView(.animation(minimumInterval: Self.blurInterval)) { context in
          frame(image)
            .blur(radius: GameState.blur(
              remaining: deadline.timeIntervalSince(context.date),
              length: state.roundLength
            ))
        }
        .accessibilityLabel("Blurred emote")
      } else {
        ProgressView()
      }

    case .reveal:
      if let image {
        frame(image)
          .accessibilityLabel(state.answer.map { "Emote: \($0)" } ?? String(localized: "Emote"))
      } else {
        symbol
      }

    case .loading, .ready:
      ProgressView()

    case .final, .lobby:
      symbol
    }
  }

  /// The game's symbol for the lobby and the end of a match.
  private var symbol: some View {
    Image(systemName: state.phase == .final ? "trophy.fill" : "gamecontroller.fill")
      .font(.system(size: min(symbolSize, Self.size / Self.symbolFraction)))
      .foregroundStyle(.tint)
      .accessibilityHidden(true)
  }

  /// Creates the stage.
  ///
  /// - Parameters:
  ///   - state: The room state.
  ///   - image: The round image, once loaded.
  ///   - received: When the state arrived.
  init(state: GameState, image: EmoteImage?, received: Date) {
    self.state = state
    self.image = image
    self.received = received
  }

  /// Draws the round image scaled to fit.
  ///
  /// - Parameter image: The decoded image.
  /// - Returns: The image view.
  private func frame(_ image: EmoteImage) -> some View {
    AnimatedEmoteView(image: image, animates: playsAnimatedImages)
      .padding(Metrics.compactSpacing)
      .accessibilityElement(children: .ignore)
      .accessibilityAddTraits(.isImage)
  }
}
