public import Foundation

/// The layers of an `/emote-compose` command, in order.
///
/// Each regular emote starts a column; overlay emotes draw over the column before them. The
/// copied text is the layers' compose tokens separated by spaces.
public struct Composition: Equatable, Sendable {
  /// Most layers one composition holds, matching the bot's command limit.
  public static let maxLayers = 32

  /// The layers in composition order.
  public private(set) var layers: [CatalogEmote] = []

  /// Whether no more layers fit.
  public var isFull: Bool {
    layers.count >= Self.maxLayers
  }

  /// The text to paste into `/emote-compose`.
  public var commandText: String {
    layers.compactMap(\.composeToken).joined(separator: " ")
  }

  /// Layers grouped into columns: a regular emote with the overlays after it.
  ///
  /// Leading overlays form a column of their own.
  public var columns: [[CatalogEmote]] {
    var grouped = [[CatalogEmote]]()
    for layer in layers {
      if layer.isOverlay, !grouped.isEmpty {
        grouped[grouped.count - 1].append(layer)
      } else {
        grouped.append([layer])
      }
    }
    return grouped
  }

  /// Creates an empty composition.
  public init() {
    // Starts with no layers.
  }

  /// Whether `name` can be one token of the command: two or more characters, no whitespace.
  public static func isComposeToken(_ name: String) -> Bool {
    name.utf16.count > 1 && !name.contains(where: \.isWhitespace)
  }

  /// Appends `emote` when it has a valid compose token and room remains.
  ///
  /// - Returns: Whether the layer was added.
  @discardableResult
  public mutating func add(_ emote: CatalogEmote) -> Bool {
    guard !isFull, let token = emote.composeToken, Self.isComposeToken(token) else {
      return false
    }

    layers.append(emote)
    return true
  }

  /// Removes the layer at `index`; out-of-range indices are ignored.
  public mutating func remove(at index: Int) {
    guard layers.indices.contains(index) else {
      return
    }

    layers.remove(at: index)
  }

  /// Moves layers as `List` reordering reports them.
  ///
  /// - Parameters:
  ///   - source: The offsets of the moved layers.
  ///   - destination: The offset to insert them at.
  public mutating func move(fromOffsets source: IndexSet, toOffset destination: Int) {
    let moved = source.filter(layers.indices.contains)
    guard !moved.isEmpty, (0 ... layers.count).contains(destination) else {
      return
    }

    let moving = moved.map { layers[$0] }
    var remaining = layers.indices.filter { !moved.contains($0) }.map { layers[$0] }
    remaining.insert(contentsOf: moving, at: destination - moved.count { $0 < destination })
    layers = remaining
  }

  /// Removes every layer.
  public mutating func clear() {
    layers.removeAll()
  }
}
