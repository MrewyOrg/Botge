import BotgeKit
import SwiftUI
import UIKit

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

  /// Converts a picked color to sRGB, ignoring opacity.
  ///
  /// - Parameter color: The picked color.
  init?(_ color: Color) {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
      return nil
    }

    self.init(
      red: Int((red * Self.channelScale).rounded()),
      green: Int((green * Self.channelScale).rounded()),
      blue: Int((blue * Self.channelScale).rounded())
    )
  }
}
