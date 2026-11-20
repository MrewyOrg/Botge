@testable import Botge
import BotgeKit
import Foundation
import SwiftUI
import Testing

struct MessageTests {
  @Test
  func `every login failure explains what to do next`() {
    let failures: [LoginFailure] = [
      .cancelled,
      .presentationUnavailable,
      .pageFailed,
      .malformedResponse,
      .stateMismatch,
      .denied("access_denied"),
      .rejected,
      .network
    ]
    let messages = failures.map { String(localized: $0.message) }
    #expect(Set(messages).count == failures.count - 1)
    #expect(messages[5].contains("access_denied"))
  }

  @Test
  func `API errors use the server's explanation or a generic one`() {
    let explained: [APIError] = [
      .busy("b"),
      .notFound("n"),
      .permissionDenied("p"),
      .rejected("r"),
      .unavailable("u")
    ]
    #expect(explained.map(\.message) == ["b", "n", "p", "r", "u"])
    let generic = APIError.busy("").message
    #expect(!generic.isEmpty)
    #expect(APIError.notFound("").message == generic)
    let fixed: [APIError] = [.malformedResponse, .network, .signedOut]
    #expect(Set(fixed.map(\.message)).count == fixed.count)
  }

  @Test
  func `pending removals are identified by what they remove`() {
    let emote = CatalogEmote(
      name: "peepoHey",
      source: .sevenTV,
      image: "/7tv-cdn/emote/A/2x.webp",
      isAnimated: false,
      sevenTVID: "A"
    )
    #expect(PendingRemoval.selection(count: 3).id == "selection|3")
    #expect(PendingRemoval.single(emote).id == emote.id)
  }

  @Test
  func `border colors convert to and from SwiftUI colors`() {
    let color = BorderColor(red: 255, green: 128, blue: 0)
    #expect(BorderColor(color.color) == color)
  }
}
