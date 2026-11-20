@testable import BotgeKit
import Foundation
import Testing

struct MarkdownBlockTests {
  @Test
  func `headings bullets and wrapped paragraphs become blocks`() {
    let document = """
    # Title

    First line
    continues here.
    - one
    * two
    ###### Deep
    #NotAHeading
    """
    let blocks = MarkdownBlock.blocks(in: document)
    #expect(blocks.map(\.kind) == [
      .heading(1),
      .paragraph,
      .bullet,
      .bullet,
      .heading(6),
      .paragraph
    ])
    #expect(blocks[1].text == "First line continues here.")
    #expect(blocks[3].text == "two")
    #expect(blocks.map(\.id) == Array(0 ..< 6))
  }

  @Test
  func `the bundled legal documents parse into headed sections`() throws {
    let root = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../docs")
    for name in ["TERMS.md", "PRIVACY.md"] {
      let text = try String(contentsOf: root.appending(path: name), encoding: .utf8)
      let blocks = MarkdownBlock.blocks(in: text)
      #expect(blocks.first?.kind == .heading(1))
      #expect(blocks.count > 10)
    }
  }

  @Test
  func `inline syntax renders as formatted text`() {
    let block = MarkdownBlock(
      id: 0,
      kind: .paragraph,
      text: "**Bold** and [link](https://botge.app)"
    )
    #expect(String(block.attributedText.characters) == "Bold and link")
  }
}
