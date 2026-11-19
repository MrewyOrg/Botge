import Foundation

/// One block of a bundled Markdown document, rendered natively instead of in a web view.
///
/// Only the block structure used by `docs/TERMS.md` and `docs/PRIVACY.md` is recognized:
/// ATX headings, `-` and `*` bullets, and paragraphs joined from wrapped lines. Inline syntax is
/// left for `AttributedString(markdown:)`.
public struct MarkdownBlock: Equatable, Identifiable, Sendable {
  /// The block's structural role.
  public enum Kind: Equatable, Sendable {
    /// A list item.
    case bullet
    /// A heading with level 1 to 6.
    case heading(Int)
    /// Running text.
    case paragraph
  }

  /// Position in the document.
  public let id: Int
  /// The structural role.
  public let kind: Kind
  /// The block's Markdown text with block markers removed.
  public let text: String

  /// Creates a block.
  ///
  /// - Parameters:
  ///   - id: The position in the document.
  ///   - kind: The structural role.
  ///   - text: The Markdown text without block markers.
  public init(id: Int, kind: Kind, text: String) {
    self.id = id
    self.kind = kind
    self.text = text
  }

  /// Splits a document into blocks.
  ///
  /// - Parameter document: The Markdown text.
  /// - Returns: The blocks in document order.
  public static func blocks(in document: String) -> [Self] {
    var parser = MarkdownParser()
    for line in document.split(separator: "\n", omittingEmptySubsequences: false) {
      parser.consume(line.trimmingCharacters(in: .whitespaces))
    }
    parser.flush()
    return parser.blocks
  }
}
