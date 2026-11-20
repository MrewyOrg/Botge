import SwiftUI

extension View {
  /// Shows `message` in a standard alert until the user dismisses it.
  ///
  /// Successes show in the interface itself and through haptics; only failures interrupt.
  ///
  /// - Parameter message: The failure to explain, cleared when the alert closes.
  /// - Returns: The view with the alert attached.
  func failureAlert(_ message: Binding<String?>) -> some View {
    alert(
      Text(message.wrappedValue ?? ""),
      isPresented: Binding {
        message.wrappedValue != nil
      } set: { isShown in
        if !isShown {
          message.wrappedValue = nil
        }
      }
    ) {
      Button("OK", role: .cancel) {
        // Closing the alert clears the message.
      }
    }
  }
}
