@testable import BotgeKit
import Foundation
import Testing

struct DiscordOAuthTests {
  private let oauth: DiscordOAuth = .init(applicationID: "123456789012345678")
  private let pkce: PKCE = .init(verifier: "dBjftJeZ4CVP-mJ92IIb7S0n8b1nfQOVjB5NI1VEu2sw")

  private func callback(_ query: String) throws -> URL {
    try #require(URL(string: "discord-123456789012345678:/authorize/callback?\(query)"))
  }

  @Test
  func `authorization URL requests identify with S256 PKCE`() throws {
    let url = oauth.authorizationURL(pkce: pkce, state: "abc")
    let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    let pairs = (components.queryItems ?? []).map { item in (item.name, item.value) }
    let items = Dictionary(uniqueKeysWithValues: pairs)
    #expect(components.host == "discord.com")
    #expect(components.path == "/oauth2/authorize")
    #expect(items["scope"] == "identify")
    #expect(items["response_type"] == "code")
    #expect(items["code_challenge"] == pkce.challenge)
    #expect(items["code_challenge_method"] == "S256")
    #expect(items["state"] == "abc")
    #expect(items["redirect_uri"] == "discord-123456789012345678:/authorize/callback")
  }

  @Test
  func `callback yields the code only when the state matches`() throws {
    #expect(try oauth
      .authorizationCode(from: callback("code=xyz&state=abc"), expectedState: "abc") == "xyz")
    #expect(throws: LoginFailure.stateMismatch) {
      try oauth.authorizationCode(from: callback("code=xyz&state=other"), expectedState: "abc")
    }
    #expect(throws: LoginFailure.stateMismatch) {
      try oauth.authorizationCode(from: callback("code=xyz"), expectedState: "abc")
    }
  }

  @Test
  func `callback reports OAuth errors and missing codes`() throws {
    #expect(throws: LoginFailure.denied("access_denied")) {
      try oauth.authorizationCode(
        from: callback("error=access_denied&state=abc"),
        expectedState: "abc"
      )
    }
    #expect(throws: LoginFailure.malformedResponse) {
      try oauth.authorizationCode(from: callback("state=abc"), expectedState: "abc")
    }
    let foreign = try #require(URL(string: "other:/authorize/callback?code=x&state=abc"))
    #expect(throws: LoginFailure.malformedResponse) {
      try oauth.authorizationCode(from: foreign, expectedState: "abc")
    }
  }

  @Test
  func `token requests are form posts without a client secret`() {
    let exchange = oauth.tokenRequest(code: "c o+de", pkce: pkce)
    let form = RequestBody.form(exchange)
    #expect(exchange.httpMethod == "POST")
    #expect(exchange.url?.absoluteString == "https://discord.com/api/v10/oauth2/token")
    #expect(form["grant_type"] == "authorization_code")
    #expect(form["code"] == "c o+de")
    #expect(form["code_verifier"] == pkce.verifier)
    #expect(form["client_secret"] == nil)

    let refresh = RequestBody.form(oauth.refreshRequest(refreshToken: "r"))
    #expect(refresh["grant_type"] == "refresh_token")
    #expect(refresh["refresh_token"] == "r")

    let revoke = oauth.revokeRequest(token: "t")
    #expect(revoke.url?.path() == "/api/v10/oauth2/token/revoke")
    #expect(RequestBody.form(revoke)["token"] == "t")
  }

  @Test
  func `token responses are validated`() throws {
    let url = try #require(URL(string: "https://discord.com"))
    let now = Date(timeIntervalSince1970: 1_000)
    func response(_ status: Int) -> URLResponse {
      HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil) ??
        URLResponse()
    }
    let json = [
      #""access_token":"a","token_type":"Bearer","expires_in":604800"#,
      #""refresh_token":"r","scope":"identify""#
    ]
    let body = Data("{\(json.joined(separator: ","))}".utf8)

    let tokens = try DiscordOAuth.tokens(from: body, response: response(200), now: now)
    #expect(tokens == OAuthTokens(
      accessToken: "a",
      refreshToken: "r",
      expiresAt: now.addingTimeInterval(604_800),
      scope: "identify"
    ))
    #expect(throws: LoginFailure.rejected) {
      try DiscordOAuth.tokens(from: body, response: response(400), now: now)
    }
    #expect(throws: LoginFailure.network) {
      try DiscordOAuth.tokens(from: body, response: response(503), now: now)
    }
    #expect(throws: LoginFailure.malformedResponse) {
      try DiscordOAuth.tokens(from: Data("{}".utf8), response: response(200), now: now)
    }
    #expect(throws: LoginFailure.malformedResponse) {
      try DiscordOAuth.tokens(from: body, response: URLResponse(), now: now)
    }
    let mac = Data(#"{"access_token":"a","token_type":"mac","expires_in":1,"scope":""}"#.utf8)
    #expect(throws: LoginFailure.malformedResponse) {
      try DiscordOAuth.tokens(from: mac, response: response(200), now: now)
    }
  }
}
