import BotgeKit
import Foundation

extension GameState {
  /// Digits of a Discord ID shown for players without a name.
  private static let shownIDDigits = 4

  /// The lobby status: why a match could not start, or who is here.
  private var lobbyStatus: String {
    if let notice {
      return notice
    }

    return players.count <= 1
      ? String(localized: "You are the only player here. Start whenever you like.")
      : String(localized: "\(players.count) players are here. Anyone can start.")
  }

  /// How a player is named on screen: "You", or "Player" and the end of their ID, as in the
  /// Activity; app rooms have no Discord participant names.
  ///
  /// - Parameters:
  ///   - id: The player's Discord account ID.
  ///   - player: The local player's Discord account ID.
  /// - Returns: The display name.
  static func name(of id: String, player: String?) -> String {
    if id == player {
      String(localized: "You")
    } else {
      String(localized: "Player \(String(id.suffix(shownIDDigits)))")
    }
  }

  /// The one-line status under the round image.
  ///
  /// - Parameter player: The local player's Discord account ID.
  /// - Returns: What is happening, in the Activity's words.
  func status(player: String?) -> String {
    switch phase {
    case .lobby:
      lobbyStatus

    case .loading:
      String(localized: "Picking emotes…")

    case .ready:
      String(localized: "Get ready…")

    case .round:
      String(localized: "Type the name of this emote.")

    case .reveal:
      revealStatus(player: player)

    case .final:
      finalStatus(player: player)
    }
  }

  /// Who named the emote, or that time ran out.
  ///
  /// - Parameter player: The local player's Discord account ID.
  /// - Returns: The reveal status.
  private func revealStatus(player: String?) -> String {
    let name = answer ?? ""
    guard let winner else {
      return String(localized: "Time is up. It was \(name).")
    }

    let earned = points ?? 0
    return winner == player
      ? String(localized: "You got it: \(name) (+\(earned)).")
      : String(localized: "\(Self.name(of: winner, player: player)) got it: \(name) (+\(earned)).")
  }

  /// The match result.
  ///
  /// - Parameter player: The local player's Discord account ID.
  /// - Returns: The final status.
  private func finalStatus(player: String?) -> String {
    switch result {
    case let .won(winner) where winner == player:
      String(localized: "Match over. You win.")

    case let .won(winner):
      String(localized: "Match over. \(Self.name(of: winner, player: player)) wins.")

    case .tie:
      String(localized: "Match over. It's a tie.")

    case .nobodyScored, nil:
      String(localized: "Match over. Nobody scored.")
    }
  }
}
