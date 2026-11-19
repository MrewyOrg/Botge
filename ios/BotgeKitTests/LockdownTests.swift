@testable import BotgeKit
import CoreGraphics
import Foundation
import Testing

/// Behavior that must hold when iOS Lockdown Mode restricts web content and media.
///
/// Lockdown Mode cannot be toggled from a test, so these tests inject the failures it causes:
/// login pages that do not finish, and image formats that refuse to decode.
struct LockdownTests {
  private static let path = "/7tv-cdn/emote/01ABC/2x.avif"

  private static func ok(_ data: Data) -> StubTransport.Reply {
    .response(status: 200, body: data)
  }

  @Test
  func `login sheet failures map to retryable messages`() {
    let domain = LoginFailure.webAuthenticationDomain
    #expect(LoginFailure(authenticationError: NSError(domain: domain, code: 1)) == .cancelled)
    #expect(LoginFailure(authenticationError: NSError(domain: domain, code: 2)) ==
      .presentationUnavailable)
    #expect(LoginFailure(authenticationError: NSError(domain: domain, code: 3)) ==
      .presentationUnavailable)
    let blockedPage = LoginFailure(authenticationError: NSError(
      domain: "WebKitErrorDomain",
      code: 102
    ))
    #expect(blockedPage == .pageFailed)
    #expect(blockedPage.isRetryable)
  }

  @Test
  func `7TV images never request AVIF and prefer WebP, GIF, then PNG`() {
    let urls = EmoteImageURL.candidates(for: Self.path).map(\.absoluteString)
    #expect(urls == [
      "https://cdn.7tv.app/emote/01ABC/2x.webp",
      "https://cdn.7tv.app/emote/01ABC/2x.gif",
      "https://cdn.7tv.app/emote/01ABC/2x.png"
    ])
    #expect(!ImageFormat.avif.isAllowed)
    #expect(EmoteImageURL.candidates(for: "/bttv-cdn/emote/1/2x.avif").isEmpty)
  }

  @Test
  func `a format that refuses to decode falls through to the next candidate`() async {
    let transport = StubTransport([
      Self.ok(Data("undecodable".utf8)),
      Self.ok(ImageFixtures.gif(frames: 3, delay: 0.05))
    ])
    let image = await EmoteImageLoader(transport: transport).image(for: Self.path, animated: true)
    guard case let .animated(frames, _) = image else {
      Issue.record("Expected the GIF candidate to animate")
      return
    }

    #expect(frames.count == 3)
    #expect(transport.requests.map { $0.url?.pathExtension } == ["webp", "gif"])
  }

  @Test
  func `an animation that fails to decode shows its first frame`() async {
    let transport = StubTransport([Self.ok(ImageFixtures.png())])
    let image = await EmoteImageLoader(transport: transport, decoder: FailingAnimationDecoder())
      .image(for: Self.path, animated: true)
    guard case .still = image else {
      Issue.record("Expected a still first frame")
      return
    }
  }

  @Test
  func `when every candidate fails the grid gets a placeholder and retries later`() async {
    let transport = StubTransport([
      .failure(.notConnectedToInternet),
      .response(status: 404, body: Data()),
      Self.ok(Data())
    ])
    let loader = EmoteImageLoader(transport: transport)
    guard case .placeholder = await loader.image(for: Self.path, animated: true) else {
      Issue.record("Expected a placeholder")
      return
    }

    _ = await loader.image(for: Self.path, animated: true)
    #expect(transport.requests.count == 6)
  }
}
