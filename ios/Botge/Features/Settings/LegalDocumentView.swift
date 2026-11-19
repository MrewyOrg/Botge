import BotgeKit
import SwiftUI

/// Renders a bundled Markdown or text document natively, without web views.
struct LegalDocumentView: View {
  let title: LocalizedStringResource
  let resource: String
  let fileExtension: String

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: Metrics.compactSpacing) {
        ForEach(blocks) { block in
          MarkdownBlockView(block: block)
        }
      }
      .padding()
      .textSelection(.enabled)
    }
    .navigationTitle(Text(title))
    .navigationBarTitleDisplayMode(.inline)
  }

  private var blocks: [MarkdownBlock] {
    guard let url = Bundle.main.url(forResource: resource, withExtension: fileExtension),
          let text = try? String(contentsOf: url, encoding: .utf8)
    else {
      return []
    }

    return fileExtension == "md"
      ? MarkdownBlock.blocks(in: text)
      : [MarkdownBlock(id: 0, kind: .paragraph, text: text)]
  }
}
