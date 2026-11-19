/// A secret store operation failed with an `OSStatus` from the Security framework.
public struct SecretStoreError: Error, Equatable, Sendable {
  /// The Security framework status code.
  public let status: Int32

  /// Wraps a Security framework status code.
  ///
  /// - Parameter status: The `OSStatus` the Security framework returned.
  public init(status: Int32) {
    self.status = status
  }
}
