/// Decodes one array element, keeping `nil` instead of failing the whole array.
///
/// Decoding `[LossyDecodable<T>]` always consumes every element, so one malformed entry in an
/// untrusted list drops only that entry.
struct LossyDecodable<Value: Decodable>: Decodable {
  /// The decoded element, or `nil` when it was malformed.
  let value: Value?

  /// Decodes the element, swallowing its error.
  ///
  /// - Parameter decoder: The element's decoder.
  init(from decoder: any Decoder) {
    value = try? Value(from: decoder)
  }
}
