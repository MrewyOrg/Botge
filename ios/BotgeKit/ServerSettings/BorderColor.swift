/// A personal emote border color, stored by Botge as six hexadecimal digits.
public struct BorderColor: Equatable, Hashable, Sendable {
  /// Plain white, the border offered before the user picks one, as in the Activity.
  public static let white: Self = .init(red: channelMax, green: channelMax, blue: channelMax)
  /// Hexadecimal digits in a color.
  static let hexLength = 6
  /// The base of ``hex``.
  static let hexRadix = 16
  /// Largest value of one channel.
  static let channelMax = 255
  /// Bits per channel.
  static let channelBits = 8
  /// How far the red channel is shifted.
  static let redShift = channelBits + channelBits

  /// The 24-bit RGB value.
  public let rgb: Int

  /// The red channel, from 0 to 255.
  public var red: Int {
    (rgb >> Self.redShift) & Self.channelMax
  }

  /// The green channel, from 0 to 255.
  public var green: Int {
    (rgb >> Self.channelBits) & Self.channelMax
  }

  /// The blue channel, from 0 to 255.
  public var blue: Int {
    rgb & Self.channelMax
  }

  /// The color as six uppercase hexadecimal digits, the form Botge saves.
  public var hex: String {
    let text = String(rgb, radix: Self.hexRadix, uppercase: true)
    return String(repeating: "0", count: Self.hexLength - text.count) + text
  }

  /// Parses six hexadecimal digits, with or without a leading `#`.
  ///
  /// - Parameter hex: The color text.
  public init?(hex: String) {
    let text = hex.hasPrefix("#") ? hex.dropFirst() : Substring(hex)
    guard text.count == Self.hexLength, text.allSatisfy({ $0.isASCII && $0.isHexDigit }),
          let value = Int(text, radix: Self.hexRadix)
    else {
      return nil
    }

    rgb = value
  }

  /// Creates a color from channels, each clamped to 0...255.
  ///
  /// - Parameters:
  ///   - red: The red channel.
  ///   - green: The green channel.
  ///   - blue: The blue channel.
  public init(red: Int, green: Int, blue: Int) {
    let channels = [red, green, blue].map { min(max($0, 0), Self.channelMax) }
    rgb = channels.reduce(0) { ($0 << Self.channelBits) | $1 }
  }
}
