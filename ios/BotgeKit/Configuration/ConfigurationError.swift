/// A deployment value in `Config/Botge.xcconfig` is missing or malformed.
public enum ConfigurationError: Error, Equatable, Sendable {
  /// `BOTGE_API_BASE_URL` is not an HTTPS URL without query or fragment.
  case invalidAPIBaseURL
  /// `DISCORD_APPLICATION_ID` is not a Discord snowflake.
  case invalidApplicationID
  /// `BOTGE_API_BASE_URL` is empty.
  case missingAPIBaseURL
  /// `DISCORD_APPLICATION_ID` is empty.
  case missingApplicationID
}
