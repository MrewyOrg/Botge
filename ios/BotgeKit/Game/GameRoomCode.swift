import Foundation

/// A Guess room that app players share by code.
///
/// App rooms use the instance ID `app-<code>`, so they never meet a Discord Activity room.
/// Codes use letters and digits that are hard to confuse; typed codes ignore case and an
/// `app-` prefix.
public struct GameRoomCode: Equatable, Hashable, Sendable {
  /// Characters in a generated code.
  public static let length = 6
  /// Characters a generated code uses: no `0`, `O`, `1`, `I` or `L`.
  static let alphabet = Array("23456789")
    + (UInt8(ascii: "A") ... UInt8(ascii: "Z"))
    .map { Character(UnicodeScalar($0)) }
    .filter { !"ILO".contains($0) }
  /// The instance ID prefix of app rooms.
  static let prefix = "app-"
  /// Longest code accepted when typed.
  static let maxLength = 32

  /// The code people type and share, such as `K7QF2M`.
  public let code: String

  /// The room's instance ID on the server.
  public var instanceID: String {
    Self.prefix + code
  }

  /// Parses a typed or shared code.
  ///
  /// - Parameter text: The code, optionally with the `app-` prefix, in any case.
  public init?(_ text: String) {
    var typed = text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    if typed.hasPrefix(Self.prefix.uppercased()) {
      typed.removeFirst(Self.prefix.count)
    }
    guard (1 ... Self.maxLength).contains(typed.count),
          typed.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) })
    else {
      return nil
    }

    code = typed
  }

  /// Wraps a code already known to be valid.
  ///
  /// - Parameter code: A valid code.
  private init(unchecked code: String) {
    self.code = code
  }

  /// Creates a new random room.
  ///
  /// - Parameter generator: The source of randomness.
  /// - Returns: A room code of ``length`` characters.
  public static func random(using generator: inout some RandomNumberGenerator) -> Self {
    let letters = String((0 ..< length).compactMap { _ in
      alphabet.randomElement(using: &generator)
    })
    return Self(letters) ?? Self(unchecked: letters)
  }

  /// Creates a new random room with the system generator.
  ///
  /// - Returns: A room code of ``length`` characters.
  public static func random() -> Self {
    var generator = SystemRandomNumberGenerator()
    return random(using: &generator)
  }
}
