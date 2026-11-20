import SwiftUI

/// Plays a model's haptic events when the user allows haptics in Settings.
private struct HapticFeedback: ViewModifier {
  /// Whether haptics play.
  @AppStorage(PreferenceKey.haptics) private var haptics = true
  /// The last event; a new one plays.
  let event: HapticEvent?

  /// Creates the modifier.
  ///
  /// - Parameter event: The last event; a new one plays.
  init(event: HapticEvent?) {
    self.event = event
  }

  func body(content: Content) -> some View {
    content.sensoryFeedback(trigger: event) { _, next in
      haptics ? next?.feedback : nil
    }
  }
}

extension View {
  /// Plays `event` when it changes, unless haptics are off in Settings.
  ///
  /// - Parameter event: A model's last haptic event.
  /// - Returns: The view with the feedback attached.
  func hapticFeedback(_ event: HapticEvent?) -> some View {
    modifier(HapticFeedback(event: event))
  }
}
