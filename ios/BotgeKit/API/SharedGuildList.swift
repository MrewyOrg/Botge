/// The body of `POST /guilds`.
struct SharedGuildList: Decodable {
  /// The servers, sorted by name.
  let guilds: [SharedGuild]
}
