/// A message the local player sends to a Guess room.
public enum GameCommand: Equatable, Sendable {
  /// Guesses the current emote's name.
  case guess(String)
  /// Starts a match; ignored while one is running.
  case start

  /// Longest guess the server checks, in UTF-8 bytes.
  public static let maxGuessBytes = 200

  /// The JSON object the room expects.
  var body: [String: String] {
    switch self {
    case .start:
      ["type": "start"]

    case let .guess(text):
      ["type": "guess", "text": text]
    }
  }
}
