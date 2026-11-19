/// The JSON error body Botge sends with a non-success status.
struct APIErrorBody: Decodable {
  /// A client-safe explanation.
  let message: String
  /// `oauth_expired` when the bearer token was rejected and renewing it may help.
  let code: String?
}
