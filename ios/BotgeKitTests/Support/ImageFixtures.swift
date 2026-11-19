import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Encodes small images in memory so decoder tests need no binary fixtures.
enum ImageFixtures {
  static let size = 8
  private static let bitsPerComponent = 8

  static func frame(red: CGFloat) -> CGImage? {
    let context = CGContext(
      data: nil,
      width: size,
      height: size,
      bitsPerComponent: bitsPerComponent,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
    context?.setFillColor(red: red, green: 0, blue: 0, alpha: 1)
    context?.fill(CGRect(x: 0, y: 0, width: size, height: size))
    return context?.makeImage()
  }

  /// An animated GIF with `frames` frames, each shown for `delay` seconds.
  static func gif(frames: Int, delay: Double) -> Data {
    encode(type: .gif, frames: frames) {
      [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: delay]]
    }
  }

  /// A single-frame PNG.
  static func png() -> Data {
    encode(type: .png, frames: 1) { [:] }
  }

  private static func encode(
    type: UTType,
    frames: Int,
    properties: () -> [CFString: Any]
  )
    -> Data
  {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
      data,
      type.identifier as CFString,
      frames,
      nil
    ) else {
      return Data()
    }

    for index in 0 ..< frames {
      if let image = frame(red: CGFloat(index) / CGFloat(max(frames, 1))) {
        CGImageDestinationAddImage(destination, image, properties() as CFDictionary)
      }
    }
    CGImageDestinationFinalize(destination)
    return data as Data
  }
}
