import CoreGraphics

/// Shared layout measurements, so views use named values instead of literals.
enum Metrics {
  /// Standard spacing between stacked groups.
  static let spacing: CGFloat = 20
  /// Spacing between related items in a group.
  static let compactSpacing: CGFloat = 12
  /// Login and lock screen logo size.
  static let logoSize: CGFloat = 112
  /// Corner radius matching the app icon at ``logoSize``.
  static let logoCornerRadius: CGFloat = 26
}
