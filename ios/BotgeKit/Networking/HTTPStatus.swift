/// HTTP status code ranges used to classify responses.
enum HTTPStatus {
  /// 2xx: the request succeeded.
  static let success = 200 ..< 300
  /// 4xx: the request was rejected; retrying it unchanged will not help.
  static let clientError = 400 ..< 500
}
