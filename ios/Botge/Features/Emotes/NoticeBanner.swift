import SwiftUI

/// A short message above the tab bar that disappears after a few seconds.
struct NoticeBanner: View {
  /// How long a notice stays visible.
  private static let duration: Duration = .seconds(seconds)
  /// ``duration`` in seconds.
  private static let seconds = 3

  /// The message, cleared when the banner hides.
  @Binding var notice: String?

  var body: some View {
    if let notice {
      Text(notice)
        .font(.callout)
        .padding(.horizontal)
        .padding(.vertical, Metrics.compactSpacing)
        .glassEffect()
        .padding()
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityIdentifier("notice")
        .task(id: notice) {
          try? await Task.sleep(for: Self.duration)
          withAnimation { self.notice = nil }
        }
    }
  }
}
