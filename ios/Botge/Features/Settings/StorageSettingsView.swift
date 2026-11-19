import SwiftUI

/// Shows the image cache size and clears it.
struct StorageSettingsView: View {
  /// Provides the caches to measure and clear.
  @Environment(AppModel.self) private var model
  /// Bytes the image cache uses on disk.
  @State private var diskUsage = 0

  var body: some View {
    Form {
      Section {
        LabeledContent("Image Cache") {
          Text(Int64(diskUsage), format: .byteCount(style: .file))
        }
        .accessibilityIdentifier("storage.size")
        Button("Clear Image Cache", systemImage: "trash", role: .destructive) {
          Task {
            await model.clearImageCache()
            diskUsage = model.urlCache.currentDiskUsage
          }
        }
        .accessibilityIdentifier("storage.clear")
      } footer: {
        Text("Emote images download again when needed. Your login and settings are kept.")
      }
    }
    .navigationTitle("Cache & Storage")
    .task { diskUsage = model.urlCache.currentDiskUsage }
  }
}
