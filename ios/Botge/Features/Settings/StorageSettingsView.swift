import SwiftUI

/// Shows the image cache size and clears it with the saved emote lists.
struct StorageSettingsView: View {
  /// Provides the caches to measure and clear.
  @Environment(AppModel.self) private var model
  /// Bytes the image cache uses on disk.
  @State private var diskUsage = 0
  /// Whether the clear confirmation is showing.
  @State private var isConfirmingClear = false

  var body: some View {
    Form {
      Section {
        LabeledContent("Image Cache") {
          Text(Int64(diskUsage), format: .byteCount(style: .file))
        }
        .accessibilityIdentifier("storage.size")
        Button("Clear Image Cache", systemImage: "trash", role: .destructive) {
          isConfirmingClear = true
        }
        .accessibilityIdentifier("storage.clear")
      } footer: {
        Text(
          "Images and saved emote lists download again when needed. Login and settings are kept."
        )
      }
    }
    .navigationTitle("Cache & Storage")
    .confirmationDialog("Clear the image cache?", isPresented: $isConfirmingClear) {
      Button("Clear Image Cache", role: .destructive) {
        Task {
          await model.clearImageCache()
          diskUsage = model.urlCache.currentDiskUsage
        }
      }
    } message: {
      Text("Emote images and saved emote lists download again when needed.")
    }
    .task { diskUsage = model.urlCache.currentDiskUsage }
  }
}
