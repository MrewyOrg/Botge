import SwiftUI

extension Binding where Value == String? {
  /// The text, or an empty string for `nil`; editing writes the text back unchanged.
  ///
  /// Blank text is turned into `nil` when the settings are normalized before saving.
  var orEmpty: Binding<String> {
    Binding<String> {
      wrappedValue ?? ""
    } set: { text in
      wrappedValue = text
    }
  }
}
