import Foundation

/// One server's emote feeds and who may manage its individual 7TV additions.
///
/// The server always lets administrators manage emotes; this policy adds everyone or chosen
/// roles. Saving replaces the whole policy.
public struct EmotePolicy: Codable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case allowedRoleIDs = "allowedRoles"
    case allowsEveryone = "allowEveryone"
    case betterTTVTwitchID = "bttvTwitchId"
    case frankerFaceZChannel = "ffzChannel"
    case sevenTVSet = "sevenTvSet"
  }

  /// Most roles the policy may allow; the server enforces the same limit.
  public static let maxRoles = 25
  /// Most digits in a Twitch user ID.
  static let maxTwitchIDLength = 20
  /// Most characters in a FrankerFaceZ channel name.
  static let maxChannelLength = 25

  /// The 7TV emote set whose emotes the server uses.
  public var sevenTVSet: String?
  /// The Twitch user ID whose BetterTTV channel emotes the server uses.
  public var betterTTVTwitchID: String?
  /// The Twitch channel name whose FrankerFaceZ emotes the server uses.
  public var frankerFaceZChannel: String?
  /// Whether every member may add and remove emotes.
  public var allowsEveryone: Bool
  /// Roles whose members may add and remove emotes.
  public var allowedRoleIDs: [String]

  /// The policy with entries trimmed, blank entries removed and the FrankerFaceZ channel in
  /// lowercase, as the Activity saves it.
  public var normalized: Self {
    var copy = self
    copy.sevenTVSet = Self.cleaned(sevenTVSet)
    copy.betterTTVTwitchID = Self.cleaned(betterTTVTwitchID)
    copy.frankerFaceZChannel = Self.cleaned(frankerFaceZChannel)?.lowercased()
    return copy
  }

  /// Whether the 7TV set is empty or a valid 7TV ID.
  public var isSevenTVSetValid: Bool {
    normalized.sevenTVSet.map(SevenTVID.isValid) ?? true
  }

  /// Whether the BetterTTV entry is empty or a Twitch user ID of up to 20 digits.
  public var isBetterTTVTwitchIDValid: Bool {
    normalized.betterTTVTwitchID.map { id in
      id.count <= Self.maxTwitchIDLength && id.allSatisfy { $0.isASCII && $0.isNumber }
    } ?? true
  }

  /// Whether the FrankerFaceZ entry is empty or a channel name of up to 25 letters, digits
  /// and underscores.
  public var isFrankerFaceZChannelValid: Bool {
    normalized.frankerFaceZChannel.map { name in
      name.count <= Self.maxChannelLength
        && name.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }
    } ?? true
  }

  /// Whether the server accepts the whole policy.
  public var isValid: Bool {
    isSevenTVSetValid && isBetterTTVTwitchIDValid && isFrankerFaceZChannelValid
      && allowedRoleIDs.count <= Self.maxRoles
  }

  /// Creates a policy.
  ///
  /// - Parameters:
  ///   - sevenTVSet: The 7TV emote set ID.
  ///   - betterTTVTwitchID: The Twitch user ID for BetterTTV.
  ///   - frankerFaceZChannel: The Twitch channel name for FrankerFaceZ.
  ///   - allowsEveryone: Whether every member may manage emotes.
  ///   - allowedRoleIDs: Roles allowed to manage emotes.
  public init(
    sevenTVSet: String? = nil,
    betterTTVTwitchID: String? = nil,
    frankerFaceZChannel: String? = nil,
    allowsEveryone: Bool = false,
    allowedRoleIDs: [String] = []
  ) {
    self.sevenTVSet = sevenTVSet
    self.betterTTVTwitchID = betterTTVTwitchID
    self.frankerFaceZChannel = frankerFaceZChannel
    self.allowsEveryone = allowsEveryone
    self.allowedRoleIDs = allowedRoleIDs
  }

  /// Trims `text` and drops it when blank.
  ///
  /// - Parameter text: A text field's value.
  /// - Returns: The trimmed text, or `nil` when nothing remains.
  private static func cleaned(_ text: String?) -> String? {
    let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
  }
}
