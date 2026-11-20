@testable import BotgeKit
import CoreGraphics
import Foundation
import ImageIO
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
  func `animation frames loop by elapsed time`() throws {
    let image = try ImageIODecoder().decodeFrames(ImageFixtures.gif(frames: 3, delay: 0.1))
    guard case let .animated(frames, _) = image else {
      Issue.record("Expected an animation")
      return
    }

    #expect(image.frame(at: -1) === frames[0])
    #expect(image.frame(at: 0.05) === frames[0])
    #expect(image.frame(at: 0.15) === frames[1])
    #expect(image.frame(at: 0.25) === frames[2])
    #expect(image.frame(at: 0.35) === frames[0])
    let still = try ImageIODecoder().decodeFrames(ImageFixtures.png())
    #expect(still.frame(at: 5) === still.firstFrame)
    #expect(EmoteImage.placeholder.frame(at: 1) == nil)
    let silent = EmoteImage.animated(frames: frames, delays: [0, 0, 0])
    #expect(silent.frame(at: 1) === frames[0])
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

  @Test
  func `frame delays fall back to the default without metadata`() throws {
    let still = try #require(CGImageSourceCreateWithData(ImageFixtures.png() as CFData, nil))
    #expect(ImageIODecoder.delay(still, at: 0) == ImageIODecoder.defaultDelay)
    #expect(ImageIODecoder.delay(still, at: 9) == ImageIODecoder.defaultDelay)
    let gif = try #require(
      CGImageSourceCreateWithData(ImageFixtures.gif(frames: 2, delay: 0.5) as CFData, nil)
    )
    #expect(ImageIODecoder.delay(gif, at: 1) == 0.5)
  }
}
