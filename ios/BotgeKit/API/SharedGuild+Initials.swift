extension SharedGuild {
  /// Most characters in ``initials``, as Discord shows them.
  static let maxInitials = 3

  /// The first character of each of the first three words of the name, as Discord shows a
  /// server without an icon.
  public var initials: String {
    String(name.split(whereSeparator: \.isWhitespace).prefix(Self.maxInitials).compactMap(\.first))
  }
}
