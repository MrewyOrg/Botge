import BotgeKit
import SwiftUI

/// A toolbar menu with the catalog filters; its symbol fills while any filter is active.
struct EmoteFilterMenu: View {
  /// The filters being edited.
  @Binding var filter: EmoteFilter
  /// Whether the filters apply to the server catalog; 7TV rankings have one source and no
  /// added state.
  let isServerCatalog: Bool

  var body: some View {
    Menu {
      if isServerCatalog {
        Picker("Source", selection: $filter.source) {
          Text("All Sources").tag(EmoteSource?.none)
          ForEach(EmoteSource.allCases, id: \.self) { source in
            Text(source.rawValue).tag(EmoteSource?.some(source))
          }
        }
      }
      Picker("Motion", selection: $filter.motion) {
        Text("Animated and Still").tag(MotionFilter.any)
        Text("Animated").tag(MotionFilter.animated)
        Text("Still").tag(MotionFilter.still)
      }
      Picker("Overlay", selection: $filter.overlay) {
        Text("Overlays and Regular").tag(OverlayFilter.any)
        Text("Overlays").tag(OverlayFilter.overlaying)
        Text("Regular").tag(OverlayFilter.regular)
      }
      if isServerCatalog {
        Toggle("Added by Server Only", isOn: $filter.showsOnlyAdded)
      }
      if filter.activeCount > 0 {
        Button("Clear Filters", systemImage: "arrow.counterclockwise") {
          let query = filter.query
          filter = EmoteFilter()
          filter.query = query
        }
      }
    } label: {
      let active = filter.activeCount > 0
      Label(
        "Filters",
        systemImage: active
          ? "line.3.horizontal.decrease.circle.fill"
          : "line.3.horizontal.decrease.circle"
      )
    }
    .accessibilityIdentifier("emotes.filters")
  }
}
