@testable import BotgeKit
import Foundation
import Testing

struct AppConfigurationTests {
  private static let applicationID = "123456789012345678"

  @Test
  func `accepts an HTTPS base URL and a snowflake ID`() throws {
    let configuration = try AppConfiguration(
      apiBaseURL: " https://botge.example.com/botge-api/app/v1 ",
      discordApplicationID: Self.applicationID
    )
    #expect(configuration.apiBaseURL.absoluteString == "https://botge.example.com/botge-api/app/v1")
    #expect(configuration.discordApplicationID == Self.applicationID)
  }

  @Test
  func `accepts plain HTTP only for loopback hosts`() throws {
    _ = try AppConfiguration(
      apiBaseURL: "http://127.0.0.1:3080",
      discordApplicationID: Self.applicationID
    )
    _ = try AppConfiguration(
      apiBaseURL: "http://localhost:3080",
      discordApplicationID: Self.applicationID
    )
    #expect(throws: ConfigurationError.invalidAPIBaseURL) {
      try AppConfiguration(
        apiBaseURL: "http://botge.example.com",
        discordApplicationID: Self.applicationID
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
      try AppConfiguration(apiBaseURL: url, discordApplicationID: Self.applicationID)
    }
  }

  @Test
  func `reports missing values before invalid ones`() {
    #expect(throws: ConfigurationError.missingAPIBaseURL) {
      try AppConfiguration(apiBaseURL: "", discordApplicationID: "x")
    }
    #expect(throws: ConfigurationError.missingApplicationID) {
      try AppConfiguration(apiBaseURL: "https://botge.example.com", discordApplicationID: nil)
    }
  }

  @Test(arguments: ["1234", "12345678901234567890123", "12345678901234567a", "１２３４５６７８９０１２３４５６７８"])
  func `rejects application IDs that are not snowflakes`(identifier: String) {
    #expect(throws: ConfigurationError.invalidApplicationID) {
      try AppConfiguration(
        apiBaseURL: "https://botge.example.com",
        discordApplicationID: identifier
      )
    }
  }

  @Test
  func `reads the Info.plist keys written by the build`() throws {
    let configuration = try AppConfiguration(infoDictionary: [
      AppConfiguration.apiBaseURLKey: "https://botge.example.com",
      AppConfiguration.applicationIDKey: Self.applicationID
    ])
    #expect(configuration.discordApplicationID == Self.applicationID)
    #expect(throws: ConfigurationError.missingAPIBaseURL) {
      try AppConfiguration(infoDictionary: [:])
    }
  }
}
