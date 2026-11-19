@testable import BotgeKit
import CoreGraphics
import Foundation
import Testing

struct ImageIODecoderTests {
  @Test
  func `animated GIFs keep every frame and their delays`() throws {
    let image = try ImageIODecoder().decodeFrames(ImageFixtures.gif(frames: 4, delay: 0.05))
    guard case let .animated(frames, delays) = image else {
      Issue.record("Expected an animation")
      return
    }

    #expect(frames.count == 4)
    #expect(delays.allSatisfy { abs($0 - 0.05) < 0.001 })
    #expect(abs(image.duration - 0.2) < 0.001)
    #expect(image.firstFrame != nil)
  }

  @Test
  func `implausibly short delays use the browser default`() throws {
    let image = try ImageIODecoder().decodeFrames(ImageFixtures.gif(frames: 2, delay: 0))
    guard case let .animated(_, delays) = image else {
      Issue.record("Expected an animation")
      return
    }

    #expect(delays == [ImageIODecoder.defaultDelay, ImageIODecoder.defaultDelay])
  }

  @Test
  func `frame count and size are bounded`() throws {
    let decoder = ImageIODecoder(maxPixelSize: 4, maxFrames: 2)
    let image = try decoder.decodeFrames(ImageFixtures.gif(frames: 5, delay: 0.1))
    guard case let .animated(frames, _) = image else {
      Issue.record("Expected an animation")
      return
    }

    #expect(frames.count == 2)
    #expect(frames.allSatisfy { $0.width <= 4 && $0.height <= 4 })
  }

  @Test
  func `single frames decode as stills`() throws {
    let image = try ImageIODecoder().decodeFrames(ImageFixtures.png())
    guard case .still = image else {
      Issue.record("Expected a still image")
      return
    }

    #expect(image.duration == 0)
    #expect(EmoteImage.placeholder.firstFrame == nil)
  }

  @Test
  func `garbage is unsupported`() {
    #expect(throws: ImageDecodingError.unsupported) {
      try ImageIODecoder().decodeFrames(Data("nope".utf8))
    }
    #expect(throws: ImageDecodingError.unsupported) {
      try ImageIODecoder().decodeFirstFrame(Data())
    }
  }
}
