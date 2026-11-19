import Foundation

/// One server's saved voice preference: the channel Botge joins and its status text.
///
/// Clearing the channel or turning the status off keeps the text for later reuse, as in the
/// Activity.
public struct VoiceSettings: Codable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case channelID = "channelId"
    case isStatusEnabled = "statusEnabled"
    case status = "statusEmoji"
  }

  /// Most UTF-8 bytes the status text may use; the server enforces the same limit.
  public static let maxStatusBytes = 128

  /// The voice channel Botge stays in, or `nil` to stay disconnected.
  public var channelID: String?
  /// Whether Botge sets ``status`` as the voice channel status.
  public var isStatusEnabled: Bool
  /// The status text, kept while the status is off.
  public var status: String?

  /// The settings with the status text trimmed, and blank text removed.
  public var normalized: Self {
    var copy = self
    let text = status?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    copy.status = text.isEmpty ? nil : text
    return copy
  }

  /// Whether the server accepts the status text: at most ``maxStatusBytes`` bytes and no
  /// control characters.
  public var isStatusValid: Bool {
    guard let text = normalized.status else {
      return true
    }

    return text.utf8.count <= Self.maxStatusBytes
      && !text.unicodeScalars.contains { $0.properties.generalCategory == .control }
  }

  /// Creates voice settings.
  ///
  /// - Parameters:
  ///   - channelID: The voice channel, or `nil` to stay disconnected.
  ///   - isStatusEnabled: Whether Botge sets the status.
  ///   - status: The status text.
  public init(channelID: String? = nil, isStatusEnabled: Bool = false, status: String? = nil) {
    self.channelID = channelID
    self.isStatusEnabled = isStatusEnabled
    self.status = status
  }
}
