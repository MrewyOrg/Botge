import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Encodes small images in memory, so image tests need no binary fixtures.
enum TestImages {
  private static let size = 8
  /// Bits per colour channel.
  private static let bitsPerComponent = 8
  /// Seconds each GIF frame shows.
  private static let frameDelay = 0.1

  /// An animated GIF with `frames` frames of a tenth of a second each.
  static func gif(frames: Int) -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
      data,
      UTType.gif.identifier as CFString,
      frames,
      nil
    ) else {
      return Data()
    }

    let properties = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: frameDelay]]
    for index in 0 ..< frames {
      if let image = frame(red: CGFloat(index) / CGFloat(frames)) {
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
      }
    }
    CGImageDestinationFinalize(destination)
    return data as Data
  }

  /// One solid frame.
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
}
