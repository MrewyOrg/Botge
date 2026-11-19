import SwiftUI

/// One scoreboard row: place, name and points, with the local player in bold.
struct GuessScoreRow: View {
  /// The player's display name.
  let name: String
  /// The player's points.
  let score: Int
  /// The player's place, from 1.
  let rank: Int
  /// Whether this is the local player.
  let isPlayer: Bool

  var body: some View {
    HStack {
      Text(rank, format: .number)
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .frame(minWidth: Metrics.spacing, alignment: .leading)
      Text(name)
        .fontWeight(isPlayer ? .semibold : .regular)
      Spacer()
      Text(score, format: .number)
        .monospacedDigit()
        .fontWeight(.semibold)
    }
    .accessibilityElement(children: .combine)
  }
}
