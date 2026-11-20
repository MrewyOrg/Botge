import BotgeKit
import SwiftUI

extension BorderColor {
  /// Largest value of one 8-bit channel.
  private static let channelScale = 255.0

  /// The color for SwiftUI.
  var color: Color {
    Color(
      .sRGB,
      red: Double(red) / Self.channelScale,
      green: Double(green) / Self.channelScale,
      blue: Double(blue) / Self.channelScale
    )
  }

  /// Converts a picked color to sRGB, ignoring opacity; channels outside sRGB are clamped.
  ///
  /// - Parameter color: The picked color.
  init(_ color: Color) {
    let resolved = color.resolve(in: EnvironmentValues())
    self.init(
      red: Self.channel(resolved.red),
      green: Self.channel(resolved.green),
      blue: Self.channel(resolved.blue)
    )
  }

  /// An 8-bit channel value from a resolved color component.
  ///
  /// - Parameter component: The component, from 0 to 1 inside sRGB.
  /// - Returns: The rounded channel value; ``init(red:green:blue:)`` clamps it.
  private static func channel(_ component: Float) -> Int {
    Int((Double(component) * channelScale).rounded())
  }
}
