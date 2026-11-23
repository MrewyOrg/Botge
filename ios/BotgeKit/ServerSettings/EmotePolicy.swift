import Foundation

/// One server's emote feeds and who may manage its individual 7TV additions.
///
/// The server always lets administrators manage emotes; this policy adds everyone or chosen
/// roles. Saving replaces the whole policy.
public struct EmotePolicy: Codable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case allowedRoleIDs = "allowedRoles"
    case allowsEveryone = "allowEveryone"
    case sevenTVSet = "sevenTvSet"
  }

  /// Most roles the policy may allow; the server enforces the same limit.
  public static let maxRoles = 25
  /// The 7TV emote set whose emotes the server uses.
  public var sevenTVSet: String?
  /// Whether every member may add and remove emotes.
  public var allowsEveryone: Bool
  /// Roles whose members may add and remove emotes.
  public var allowedRoleIDs: [String]

  /// The policy with the set ID trimmed and blank values removed.
  public var normalized: Self {
    var copy = self
    copy.sevenTVSet = Self.cleaned(sevenTVSet)
    return copy
  }

  /// Whether the 7TV set is empty or a valid 7TV ID.
  public var isSevenTVSetValid: Bool {
    normalized.sevenTVSet.map(SevenTVID.isValid) ?? true
  }

  /// Whether the server accepts the whole policy.
  public var isValid: Bool {
    isSevenTVSetValid && allowedRoleIDs.count <= Self.maxRoles
  }

  /// Creates a policy.
  ///
  /// - Parameters:
  ///   - sevenTVSet: The 7TV emote set ID.
  ///   - allowsEveryone: Whether every member may manage emotes.
  ///   - allowedRoleIDs: Roles allowed to manage emotes.
  public init(
    sevenTVSet: String? = nil,
    allowsEveryone: Bool = false,
    allowedRoleIDs: [String] = []
  ) {
    self.sevenTVSet = sevenTVSet
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
