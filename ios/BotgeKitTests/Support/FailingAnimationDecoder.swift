@testable import BotgeKit
import CoreGraphics
import Foundation

/// Decodes first frames but rejects animations, as a restricted decoder would.
struct FailingAnimationDecoder: ImageDecoding {
  func decodeFrames(_: Data) throws(ImageDecodingError) -> EmoteImage {
    throw .unsupported
  }

  func decodeFirstFrame(_ data: Data) throws(ImageDecodingError) -> CGImage {
    try ImageIODecoder().decodeFirstFrame(data)
  }
}
