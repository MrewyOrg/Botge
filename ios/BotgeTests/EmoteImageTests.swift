@testable import Botge
import BotgeKit
import SwiftUI
import Testing
import ViewInspector

struct EmoteImageTests {
  /// A Twitch path the image transport answers with an animated GIF.
  private static let animatedPath = "/twitch-cdn/emoticons/v2/G/default/dark/2.0"
  /// A Twitch path whose image fails to load.
  private static let missingPath = "/twitch-cdn/emoticons/v2/M/default/dark/2.0"

  private static func app() async -> AppModel {
    await Fixtures.signedIn(transport: RoutedTransport([
      "G/default/dark/2.0": [.bytes(TestImages.gif(frames: 3))]
    ]))
  }

  /// Runs the image view's load task.
  ///
  /// - Throws: An inspection error when the view has no load task.
  private static func load(_ view: EmoteImageView, animated: Bool, app: AppModel) async throws {
    try await view.environment(app)
      .inspect()
      .find(EmoteImageView.self)
      .group()
      .callTask(id: "\(view.path)|\(animated)")
  }

  @Test
  func `animated emotes load the first frame, then every frame, then from memory`() async throws {
    let app = await Self.app()
    let view = EmoteImageView(
      path: Self.animatedPath,
      isAnimated: true,
      fallbackPath: nil,
      priority: .utility
    )
    try await Self.load(view, animated: true, app: app)
    #expect(app.imageLoader.cachedImage(for: Self.animatedPath, animated: true) != nil)
    try await Self.load(view, animated: true, app: app)
    #expect(throws: Never.self) {
      try view.environment(app).inspect().find(AnimatedEmoteView.self)
    }
  }

  @Test
  func `a playing fallback stays until the new image is ready`() async throws {
    let app = await Self.app()
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
}
