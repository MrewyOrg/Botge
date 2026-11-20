@testable import Botge
import AppIntents
import Testing

@Suite(.serialized)
struct IntentTests {
  @Test
  func `intents open the Guess tab and search emotes`() {
    let model = Fixtures.model(signedIn: true)
    let open = OpenGuessIntent()
    open.model = model
    _ = open.perform()
    #expect(model.selectedTab == .guess)

    let search = SearchEmotesIntent()
    search.model = model
    search.search = "  catJAM "
    _ = search.perform()
    #expect(model.selectedTab == .emotes)
    #expect(model.pendingSearch == "catJAM")
  }

  @Test
  func `shortcuts offer search and Guess`() {
    #expect(BotgeShortcuts.appShortcuts.count == 2)
    #expect(BotgeShortcuts.shortcutTileColor == .purple)
  }
}
