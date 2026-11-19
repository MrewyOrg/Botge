/// Image container formats seen on provider CDNs, inferred from the file extension.
public enum ImageFormat: String, CaseIterable, Sendable {
  case avif
  case gif
  case jpeg
  case png
  case unknown
  case webp

  /// Formats requested for 7TV images, most preferred first.
  ///
  /// All of them decode with ImageIO and none depend on WebKit, so they keep working in Lockdown
  /// Mode. AVIF is never requested: some restricted configurations refuse it, and every 7TV image
  /// is also published as WebP, GIF and PNG.
  public static let preferred: [Self] = [.webp, .gif, .png]

  /// Whether the app may request this format.
  public var isAllowed: Bool {
    Self.preferred.contains(self) || self == .jpeg
  }

  /// Infers the format from a path's extension.
  public init(path: String) {
    let name = path.split(separator: "/").last ?? ""
    let fileExtension = name.split(separator: ".").dropFirst().last.map { $0.lowercased() } ?? ""
    switch fileExtension {
    case "avif":
      self = .avif

    case "gif":
      self = .gif

    case "jpeg", "jpg":
      self = .jpeg

    case "png":
      self = .png

    case "webp":
      self = .webp

    default:
      self = .unknown
    }
  }
}
