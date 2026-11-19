import BotgeKit
import SwiftUI

/// One Markdown block with inline formatting and links.
struct MarkdownBlockView: View {
  private static let titleLevel = 1
  private static let sectionLevel = 2
  private static let fonts: [Int: Font] = [titleLevel: .title.bold(), sectionLevel: .title3.bold()]

  let block: MarkdownBlock

  var body: some View {
    switch block.kind {
    case .bullet:
      HStack(alignment: .firstTextBaseline) {
        Text(verbatim: "•").accessibilityHidden(true)
        Text(attributed)
      }

    case let .heading(level):
      Text(attributed)
        .font(Self.fonts[level] ?? .headline)
        .accessibilityAddTraits(.isHeader)
        .padding(.top, Metrics.compactSpacing)

    case .paragraph:
      Text(attributed)
    }
  }

  private var attributed: AttributedString {
    let options = AttributedString.MarkdownParsingOptions(
      interpretedSyntax: .inlineOnlyPreservingWhitespace
    )
    return (try? AttributedString(markdown: block.text, options: options))
      ?? AttributedString(block.text)
  }
}
