/// Accumulates wrapped Markdown lines into ``MarkdownBlock`` values.
struct MarkdownParser {
  /// ATX heading levels.
  private static let headingLevels = 1 ... 6
  /// Prefixes that start a list item.
  private static let bulletMarkers = ["- ", "* "]

  /// Blocks completed so far.
  private(set) var blocks: [MarkdownBlock] = []
  /// Kind of the block being accumulated.
  private var kind = MarkdownBlock.Kind.paragraph
  /// Lines of the block being accumulated.
  private var lines: [String] = []

  /// Parses an ATX heading line, or returns `nil`.
  private static func heading(_ line: String) -> (level: Int, text: String)? {
    let level = line.prefix { $0 == "#" }.count
    guard headingLevels.contains(level), line.dropFirst(level).first == " " else {
      return nil
    }

    return (level, String(line.dropFirst(level + 1)))
  }

  /// Adds one trimmed line.
  mutating func consume(_ line: String) {
    if line.isEmpty {
      flush()
    } else if let heading = Self.heading(line) {
      flush()
      append(.heading(heading.level), heading.text)
    } else if let marker = Self.bulletMarkers.first(where: line.hasPrefix) {
      flush()
      kind = .bullet
      lines = [String(line.dropFirst(marker.count))]
    } else {
      lines.append(line)
    }
  }

  /// Ends the current block.
  mutating func flush() {
    if !lines.isEmpty {
      append(kind, lines.joined(separator: " "))
    }
    kind = .paragraph
    lines = []
  }

  /// Appends a block numbered by its position.
  private mutating func append(_ kind: MarkdownBlock.Kind, _ text: String) {
    blocks.append(MarkdownBlock(id: blocks.count, kind: kind, text: text))
  }
}
