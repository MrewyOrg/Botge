@testable import BotgeKit
import Foundation
import Testing

struct AppConfigurationTests {
  private static let applicationID = "123456789012345678"

  @Test
  func `accepts an HTTPS base URL and a snowflake ID`() throws {
    let configuration = try AppConfiguration(
      apiBaseURL: " https://botge.example.com/botge-api/app/v1 ",
      discordApplicationID: Self.applicationID,
      allowsLocalHTTP: false
    )
    #expect(configuration.apiBaseURL.absoluteString == "https://botge.example.com/botge-api/app/v1")
    #expect(configuration.discordApplicationID == Self.applicationID)
  }

  @Test(arguments: [
    "http://127.0.0.1:3080",
    "http://localhost:3080",
    "http://192.168.0.12:3080/app/v1",
    "http://10.0.0.5:3080",
    "http://172.20.1.2:3080",
    "http://169.254.3.4:3080",
    "http://my-mac.local:3080"
  ])
  func `development builds accept plain HTTP to local hosts and release builds never do`(
    url: String
  )
    throws
  {
    _ = try AppConfiguration(
      apiBaseURL: url,
      discordApplicationID: Self.applicationID,
      allowsLocalHTTP: true
    )
    #expect(throws: ConfigurationError.invalidAPIBaseURL) {
      try AppConfiguration(
        apiBaseURL: url,
        discordApplicationID: Self.applicationID,
        allowsLocalHTTP: false
      )
    }
  }

  @Test(arguments: [
    "http://botge.example.com",
    "http://8.8.8.8:3080",
    "http://172.32.0.1:3080",
    "http://192.169.0.1:3080",
    "http://192.168.0:3080",
    "http://192.168.0.300:3080"
  ])
  func `rejects plain HTTP to public hosts`(url: String) {
    #expect(throws: ConfigurationError.invalidAPIBaseURL) {
      try AppConfiguration(
        apiBaseURL: url,
        discordApplicationID: Self.applicationID,
        allowsLocalHTTP: true
      )
    }
  }

  @Test(arguments: [
    "ftp://botge.example.com",
    "https://botge.example.com?x=1",
    "https://botge.example.com#a",
    "https://"
  ])
  func `rejects malformed base URLs`(url: String) {
    #expect(throws: ConfigurationError.invalidAPIBaseURL) {
      try AppConfiguration(
        apiBaseURL: url,
        discordApplicationID: Self.applicationID,
        allowsLocalHTTP: true
      )
    }
  }

  @Test
  func `reports missing values before invalid ones`() {
    #expect(throws: ConfigurationError.missingAPIBaseURL) {
      try AppConfiguration(apiBaseURL: "", discordApplicationID: "x", allowsLocalHTTP: true)
    }
    #expect(throws: ConfigurationError.missingApplicationID) {
      try AppConfiguration(
        apiBaseURL: "https://botge.example.com",
        discordApplicationID: nil,
        allowsLocalHTTP: true
      )
    }
  }

  @Test(arguments: ["1234", "12345678901234567890123", "12345678901234567a", "１２３４５６７８９０１２３４５６７８"])
  func `rejects application IDs that are not snowflakes`(identifier: String) {
    #expect(throws: ConfigurationError.invalidApplicationID) {
      try AppConfiguration(
        apiBaseURL: "https://botge.example.com",
        discordApplicationID: identifier,
        allowsLocalHTTP: true
      )
    }
  }

  @Test
  func `reads the Info.plist keys written by the build`() throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let info = [
      AppConfiguration.apiBaseURLKey: "https://botge.example.com",
      AppConfiguration.applicationIDKey: Self.applicationID
    ]
    try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
      .write(to: directory.appending(path: "Info.plist"))
    let bundle = try #require(Bundle(url: directory))
    let configuration = try AppConfiguration(bundle: bundle, allowsLocalHTTP: false)
    #expect(configuration.discordApplicationID == Self.applicationID)
    #expect(throws: ConfigurationError.missingAPIBaseURL) {
      try AppConfiguration(bundle: Bundle(for: ScriptedConnector.self), allowsLocalHTTP: true)
    }
  }

  @Test
  func `app links open known tabs for this build's scheme only`() throws {
    let scheme = "dev.example.botge"
    let guess = try #require(AppLink.guess.url(scheme: scheme))
    #expect(guess.absoluteString == "dev.example.botge://guess")
    #expect(AppLink(url: guess, scheme: scheme) == .guess)
    #expect(try AppLink(url: #require(URL(string: "DEV.example.botge://Emotes")), scheme: scheme)
      == .emotes)
    for text in ["other.app://guess", "dev.example.botge://settings", "dev.example.botge:guess"] {
      #expect(try AppLink(url: #require(URL(string: text)), scheme: scheme) == nil)
    }
    #expect(try AppLink(url: #require(URL(string: "x://guess")), scheme: "") == nil)
    #expect(AppLink.guess.url(scheme: "") == nil)
  }
}
