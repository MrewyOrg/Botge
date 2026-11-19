public import Foundation

/// Calls the Botge app API (`/app/v1`) with the signed-in user's Discord token.
///
/// Every request is a JSON `POST`, like the Activity's. When Botge reports an expired token
/// (`oauth_expired`), the client renews it once and retries, mirroring the Activity.
public actor BotgeAPI {
  /// The code Botge sends when it rejected the bearer token.
  static let expiredCode = "oauth_expired"
  /// HTTP 401.
  static let unauthorizedStatus = 401

  /// The app API base URL, such as `https://botge.example.com/botge-api/app/v1`.
  private let baseURL: URL
  /// Provides and renews the bearer token.
  private let session: AuthSession
  /// Sends requests.
  private let transport: any HTTPTransport

  /// Creates a client for one deployment.
  public init(baseURL: URL, session: AuthSession, transport: any HTTPTransport) {
    self.baseURL = baseURL
    self.session = session
    self.transport = transport
  }

  /// Lists the servers the user shares with Botge, sorted by name.
  ///
  /// - Throws: ``APIError`` for rejected, failed, or malformed requests.
  public func guilds() async throws(APIError) -> [SharedGuild] {
    let list: SharedGuildList = try await post("guilds", body: [String: String]())
    return list.guilds
  }

  /// Posts `body` as JSON to `path` and decodes the answer.
  ///
  /// - Throws: ``APIError/signedOut`` when the token cannot be renewed, and other ``APIError``
  ///   cases for failed, rejected, or malformed requests.
  func post<Response: Decodable>(_ path: String, body: some Encodable & Sendable)
    async throws(APIError) -> Response
  {
    let data = try await send(path, body: body, renewed: false)
    guard let response = try? JSONDecoder().decode(Response.self, from: data) else {
      throw .malformedResponse
    }

    return response
  }

  /// Sends one request, renewing the token and retrying once after `oauth_expired`.
  ///
  /// - Throws: ``APIError`` as described for ``post(_:body:)``.
  private func send(_ path: String, body: some Encodable & Sendable, renewed: Bool)
    async throws(APIError) -> Data
  {
    let token = try await bearer(renew: renewed)
    var request = URLRequest(url: baseURL.appending(path: path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.httpBody = try? JSONEncoder().encode(body)

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await transport.data(for: request)
    } catch {
      throw .network
    }
    guard let status = (response as? HTTPURLResponse)?.statusCode else {
      throw .malformedResponse
    }

    if HTTPStatus.success.contains(status) {
      return data
    }

    let failure = try? JSONDecoder().decode(APIErrorBody.self, from: data)
    if status == Self.unauthorizedStatus {
      guard failure?.code == Self.expiredCode, !renewed else {
        throw .signedOut
      }

      return try await send(path, body: body, renewed: true)
    }
    throw APIError.classify(status: status, message: failure?.message ?? "")
  }

  /// Returns a current token, renewing it first when `renew` is set.
  ///
  /// - Throws: ``APIError/signedOut`` when the session has no usable token and
  ///   ``APIError/network`` when renewal cannot reach Discord.
  private func bearer(renew: Bool) async throws(APIError) -> String {
    do {
      if renew {
        return try await session.renew().accessToken
      }

      return try await session.accessToken()
    } catch AuthSessionError.signedOut {
      throw .signedOut
    } catch {
      throw .network
    }
  }
}
