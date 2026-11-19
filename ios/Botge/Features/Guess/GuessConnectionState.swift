/// Whether the Guess tab is connected to its room.
enum GuessConnectionState: Equatable {
  /// Receiving the room's state.
  case connected
  /// The room cannot be reached; the text explains why.
  case failed(String)
  /// Joining the room for the first time.
  case joining
  /// The connection dropped; the app is joining again.
  case reconnecting
}
