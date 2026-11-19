public import Foundation

/// Deployment values compiled into the app bundle from `Config/Botge.xcconfig`.
///
/// The app talks to exactly one Botge deployment. Forks set their own values in a local
/// `Botge.local.xcconfig`; nothing here is entered at run time.
public struct AppConfiguration: Equatable, Sendable {
  /// Info.plist key holding the Botge app API base URL.
  public static let apiBaseURLKey = "BotgeAPIBaseURL"
  /// Info.plist key holding the Discord application ID.
  public static let applicationIDKey = "DiscordApplicationID"

  /// Valid lengths of a Discord snowflake ID.
  static let snowflakeLengths = 17 ... 20

  /// Botge app API base URL, for example `https://botge.example.com/botge-api/app/v1`.
  public let apiBaseURL: URL
  /// Discord application (client) ID used for OAuth and the callback URL scheme.
  public let discordApplicationID: String

  /// Validates deployment values.
  ///
  /// The API URL must use HTTPS, except for loopback hosts used during local development.
  /// The application ID must be a Discord snowflake: 17 to 20 decimal digits.
  ///
  /// - Parameters:
  ///   - apiBaseURL: The API base URL text.
  ///   - discordApplicationID: The application ID text.
  /// - Throws: ``ConfigurationError`` when a value is missing or malformed.
  public init(apiBaseURL: String?, discordApplicationID: String?) throws(ConfigurationError) {
    let urlText = apiBaseURL?.trimmingCharacters(in: .whitespaces) ?? ""
    guard !urlText.isEmpty else {
      throw .missingAPIBaseURL
    }
    guard let url = URL(string: urlText),
          let host = url.host(),
          url.scheme == "https" || (url.scheme == "http" && Self.isLoopback(host)),
          url.query() == nil,
          url.fragment() == nil
    else {
      throw .invalidAPIBaseURL
    }

    let identifier = discordApplicationID?.trimmingCharacters(in: .whitespaces) ?? ""
    guard !identifier.isEmpty else {
      throw .missingApplicationID
    }
    guard Self.isSnowflake(identifier) else {
      throw .invalidApplicationID
    }

    self.apiBaseURL = url
    self.discordApplicationID = identifier
  }

  /// Reads the values that the build wrote into an Info.plist dictionary.
  ///
  /// - Parameter infoDictionary: The app bundle's Info.plist values.
  /// - Throws: ``ConfigurationError`` when a value is missing or malformed.
  public init(infoDictionary: [String: Any]) throws(ConfigurationError) {
    try self.init(
      apiBaseURL: infoDictionary[Self.apiBaseURLKey] as? String,
      discordApplicationID: infoDictionary[Self.applicationIDKey] as? String
    )
  }

  /// Whether `text` is a Discord snowflake ID: 17 to 20 ASCII digits.
  public static func isSnowflake(_ text: String) -> Bool {
    snowflakeLengths.contains(text.count) && text.allSatisfy { $0.isASCII && $0.isNumber }
  }

  private static func isLoopback(_ host: String) -> Bool {
    ["localhost", "127.0.0.1", "::1"].contains(host)
  }
}
