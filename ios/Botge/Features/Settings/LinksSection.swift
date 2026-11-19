import SwiftUI

/// Links to storage management and the About screen.
struct LinksSection: View {
  var body: some View {
    Section {
      NavigationLink {
        StorageSettingsView()
      } label: {
        Label("Cache & Storage", systemImage: "internaldrive")
      }
      NavigationLink {
        AboutView()
      } label: {
        Label("About & Legal", systemImage: "info.circle")
      }
    }
  }
}
