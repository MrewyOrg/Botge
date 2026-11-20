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
    // Frames are rendered bitmaps Core Animation shows without decoding again.
    let layout = frames.map { ($0.alphaInfo, $0.byteOrderInfo, $0.bitsPerPixel) }
    #expect(layout.allSatisfy { $0 == (.premultipliedFirst, .order32Little, 32) })
  }

  @Test
  func `key times start each frame at its share of the loop`() throws {
    let image = EmoteImage.animated(frames: [], delays: [0.1, 0.3, 0.1, 0.5])
    #expect(image.keyTimes.map { ($0 * 10).rounded() / 10 } == [0, 0.1, 0.4, 0.5, 1])
    let still = try ImageIODecoder().decodeFrames(ImageFixtures.png())
    #expect(still.keyTimes.isEmpty)
    #expect(EmoteImage.placeholder.keyTimes.isEmpty)
    #expect(EmoteImage.animated(frames: [], delays: [0, 0]).keyTimes.isEmpty)
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
