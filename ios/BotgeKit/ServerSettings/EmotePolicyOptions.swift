import Foundation

/// A saved emote policy with the server's roles for the manager picker.
public struct EmotePolicyOptions: Decodable, Equatable, Sendable {
  private enum CodingKeys: String, CodingKey {
    case roles
  }

  /// The saved policy.
  public let policy: EmotePolicy
  /// Roles the administrator can allow, in Discord's order.
  public let roles: [GuildRole]

  /// The role picker entries: ``roles``, then saved roles the server no longer lists, so they
  /// stay visible until the user removes them.
  public var choices: [GuildRole] {
    let known = Set(roles.map(\.id))
    let missing = policy.allowedRoleIDs.filter { !known.contains($0) }.map { id in
      GuildRole(id: id, name: String(localized: "Unavailable Role"))
    }
    return roles + missing
  }

  /// Creates policy options.
  ///
  /// - Parameters:
  ///   - policy: The saved policy.
  ///   - roles: The server's roles.
  public init(policy: EmotePolicy, roles: [GuildRole]) {
    self.policy = policy
    self.roles = roles
  }

  /// Decodes the flattened response: the policy fields beside `roles`.
  ///
  /// - Parameter decoder: The response decoder.
  /// - Throws: `DecodingError` when a field is missing or has the wrong type.
  public init(from decoder: any Decoder) throws {
    policy = try EmotePolicy(from: decoder)
    roles = try decoder.container(keyedBy: CodingKeys.self).decode([GuildRole].self, forKey: .roles)
  }
}
