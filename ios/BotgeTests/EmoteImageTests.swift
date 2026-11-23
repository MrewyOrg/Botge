@testable import Botge
import BotgeKit
import QuartzCore
import SwiftUI
import Testing
import UIKit
import ViewInspector

struct EmoteImageTests {
  /// A 7TV path the image transport answers with an animated GIF.
  private static let animatedPath = "/7tv-cdn/emote/G/2x.gif"
  /// 7TV's PNG variant of the fallback used by the still image view.
  private static let stillPath = "/7tv-cdn/emote/G/2x.png"
  /// A 7TV path whose image fails to load.
  private static let missingPath = "/7tv-cdn/emote/M/2x.gif"

  private static func app() async throws -> AppModel {
    let frame = try #require(TestImages.frame(red: 1))
    let png = try #require(UIImage(cgImage: frame).pngData())
    return await Fixtures.signedIn(transport: RoutedTransport([
      "G/2x.gif": [.bytes(TestImages.gif(frames: 3))],
      "G/2x.png": [.bytes(png)]
    ]))
  }

  /// Runs the image view's load task.
  ///
  /// - Throws: An inspection error when the view has no load task.
  private static func load(_ view: EmoteImageView, animated: Bool, app: AppModel) async throws {
    try await view.environment(\.forcesEmoteAnimation, animated)
      .environment(app)
      .inspect()
      .find(EmoteImageView.self)
      .group()
      .callTask(id: "\(view.path)|\(animated)")
  }

  @Test
  func `animated emotes load the first frame, then every frame, then from memory`() async throws {
    let app = try await Self.app()
    let view = EmoteImageView(
      path: Self.animatedPath,
      isAnimated: true,
      fallbackPath: nil,
      priority: .utility
    )
    try await Self.load(view, animated: true, app: app)
    guard case .still? = app.imageLoader.cachedImage(for: Self.animatedPath, animated: false),
          case let .animated(frames, _)? = app.imageLoader.cachedImage(
            for: Self.animatedPath,
            animated: true
          )
    else {
      Issue.record("The load task did not cache both image representations")
      return
    }

    #expect(frames.count == 3)
    let playing = view.environment(\.forcesEmoteAnimation, true)
    await Hosting.show(playing, model: app)
    #expect(throws: Never.self) {
      try playing.environment(app).inspect().find(AnimatedEmoteView.self)
    }
  }

  @Test
  func `a playing fallback stays until the new image is ready`() async throws {
    let app = try await Self.app()
    try await Self.load(
      EmoteImageView(
        path: Self.animatedPath,
        isAnimated: true,
        fallbackPath: nil,
        priority: .utility
      ),
      animated: true,
      app: app
    )
    let preview = EmoteImageView(
      path: Self.missingPath,
      isAnimated: true,
      fallbackPath: Self.animatedPath,
      priority: .userInitiated
    )
    try await Self.load(preview, animated: true, app: app)
    #expect(throws: Never.self) {
      try preview.environment(\.forcesEmoteAnimation, true)
        .environment(app)
        .inspect()
        .find(AnimatedEmoteView.self)
    }
    guard case .still = await app.imageLoader.image(for: Self.stillPath, animated: false) else {
      Issue.record("The still fallback did not load")
      return
    }

    let still = EmoteImageView(
      path: Self.missingPath,
      isAnimated: false,
      fallbackPath: Self.animatedPath,
      priority: .utility
    )
    try await Self.load(still, animated: false, app: app)
    #expect(throws: Never.self) {
      try still.environment(app).inspect().find(AnimatedEmoteView.self)
    }
  }

  @Test
  func `animations play over time and placeholders show a symbol`() async throws {
    let frames = [TestImages.frame(red: 0), TestImages.frame(red: 1)].compactMap(\.self)
    let animated = AnimatedEmoteView(
      image: .animated(frames: frames, delays: [0.1, 0.1]),
      animates: true
    )
    await Hosting.show(animated, model: Fixtures.misconfigured())
    let placeholder = AnimatedEmoteView(image: .placeholder, animates: false)
    #expect(throws: Never.self) { try placeholder.inspect().find(ViewType.Image.self) }
  }

  @Test
  func `layers play frames through Core Animation and stop when asked`() throws {
    let frames = [TestImages.frame(red: 0), TestImages.frame(red: 1)].compactMap(\.self)
    let image = EmoteImage.animated(frames: frames, delays: [0.25, 0.75])
    let layer = CALayer()
    EmoteFramesView.show(image, animates: true, in: layer)
    let playing = try #require(
      layer.animation(forKey: EmoteFramesView.animationKey) as? CAKeyframeAnimation
    )
    #expect(playing.calculationMode == .discrete && playing.repeatCount == .infinity)
    #expect(playing.keyTimes == [0, 0.25, 1])
    #expect(playing.duration == 1)
    #expect(layer.contents as AnyObject? === frames.first)

    EmoteFramesView.show(image, animates: true, in: layer)
    let kept = layer.animation(forKey: EmoteFramesView.animationKey) as? CAKeyframeAnimation
    #expect(kept?.timeOffset == playing.timeOffset)

    let reversed = EmoteImage.animated(frames: frames.reversed(), delays: [0.25, 0.75])
    EmoteFramesView.show(reversed, animates: true, in: layer)
    let replaced = layer.animation(forKey: EmoteFramesView.animationKey) as? CAKeyframeAnimation
    #expect((replaced?.values?.first as AnyObject?) === frames.last)

    EmoteFramesView.show(image, animates: false, in: layer)
    #expect(layer.animation(forKey: EmoteFramesView.animationKey) == nil)
    EmoteFramesView.show(.placeholder, animates: true, in: layer)
    #expect(layer.contents == nil)
  }
}
