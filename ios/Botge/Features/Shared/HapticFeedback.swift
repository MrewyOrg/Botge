import SwiftUI

/// Plays a model's haptic events; the system haptics setting decides whether they are felt.
private struct HapticFeedback: ViewModifier {
  /// The last event; a new one plays.
  let event: HapticEvent?

  func body(content: Content) -> some View {
    content.sensoryFeedback(trigger: event) { _, next in
      next?.feedback
    }
  }
}

extension View {
  /// Plays `event` when it changes.
  ///
  /// - Parameter event: A model's last haptic event.
  /// - Returns: The view with the feedback attached.
  func hapticFeedback(_ event: HapticEvent?) -> some View {
    modifier(HapticFeedback(event: event))
  }
}
