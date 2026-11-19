/// 7TV emote ID validation, matching the Activity and the bot.
public enum SevenTVID {
  /// Characters in a legacy hexadecimal ID.
  static let legacyLength = 24
  /// Characters in a current alphanumeric ID.
  static let currentLength = 26

  /// Whether `id` is a 24-digit hexadecimal or 26-character alphanumeric 7TV ID.
  public static func isValid(_ id: String) -> Bool {
    guard id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else {
      return false
    }

    switch id.count {
    case legacyLength:
      return id.allSatisfy(\.isHexDigit)

    case currentLength:
      return true

    default:
      return false
    }
  }
}
