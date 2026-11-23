import BotgeKit
import Foundation
import SwiftUI

/// Lists retained changes and lets an administrator preview and confirm a restore.
struct CatalogHistoryView: View {
  /// Authenticated client for the current deployment.
  let api: BotgeAPI
  /// Guild whose history is shown.
  let guild: String
  /// Refreshes the parent form after a successful restore.
  let onRestore: () async -> Void

  /// The currently loaded revision list.
  @State private var history: CatalogHistory?
  /// The selected revision and its proposed changes.
  @State private var preview: CatalogRestorePreview?
  /// Whether a request is in progress.
  @State private var isBusy = false
  /// Whether the restore confirmation is visible.
  @State private var confirming = false
  /// The last request result displayed in the list.
  @State private var message: String?

  var body: some View {
    List {
      if let message {
        Text(message)
          .foregroundStyle(.secondary)
      }
      if let preview {
        previewSection(preview)
      }
      if let history {
        Section("Current revision #\(history.currentRevision)") {
          if history.revisions.isEmpty {
            Text("No catalog changes have been recorded.")
          }
          ForEach(history.revisions) { entry in
            Button {
              Task { await openPreview(entry.revision) }
            } label: {
              revisionLabel(entry)
            }
            .accessibilityIdentifier("history.revision.\(entry.id)")
          }
        }
      }
      if isBusy {
        ProgressView()
      }
    }
    .disabled(isBusy)
    .navigationTitle("Catalog History")
    .toolbar {
      Button("Refresh", systemImage: "arrow.clockwise") {
        Task { await load() }
      }
      .disabled(isBusy)
      .accessibilityIdentifier("history.refresh")
    }
    .task { await load() }
  }

  /// Shows the diff and confirmation control for the selected revision.
  ///
  /// - Parameter entry: The changes to display.
  /// - Returns: The preview section.
  private func previewSection(_ entry: CatalogRestorePreview) -> some View {
    Section("Restore revision #\(entry.targetRevision)") {
      changes("Add", entry.added)
      changes("Remove", entry.removed)
      changes("Update", entry.updated)
      if entry.orderChanged {
        Text("Restore the previous catalog order.")
      }
      if entry.currentSettings != entry.restoredSettings {
        LabeledContent("Current settings", value: policy(entry.currentSettings))
        LabeledContent("Restore settings", value: policy(entry.restoredSettings))
      }
      if entry.hasChanges {
        Button("Restore This Revision", role: .destructive) { confirming = true }
          .accessibilityIdentifier("history.preview.restore")
          .confirmationDialog("Restore this catalog revision?", isPresented: $confirming) {
            Button("Restore Catalog", role: .destructive) {
              Task { await restore(entry) }
            }
            .accessibilityIdentifier("history.confirm")
          } message: {
            Text("The changes shown here will be recorded as a new revision.")
          }
      } else {
        Text("This revision already matches the saved catalog.")
      }
    }
  }

  @ViewBuilder
  private func changes(_ title: LocalizedStringKey, _ names: [String]) -> some View {
    if !names.isEmpty {
      LabeledContent(title, value: names.joined(separator: ", "))
    }
  }

  private func policy(_ value: EmotePolicy) -> String {
    let set = value.sevenTVSet ?? String(localized: "Off")
    let everyone = value.allowsEveryone ? String(localized: "On") : String(localized: "Off")
    let roles = value.allowedRoleIDs.isEmpty
      ? String(localized: "None")
      : value.allowedRoleIDs.joined(separator: ", ")
    return String(
      localized: "7TV set: \(set) · All members can edit: \(everyone) · Manager roles: \(roles)"
    )
  }

  private func revisionLabel(_ entry: CatalogRevision) -> some View {
    let action: LocalizedStringKey =
      switch entry.edit.type {
      case "baseline":
        "Starting catalog"

      case "added":
        "Emote added"

      case "removed":
        "Emote removed"

      case "settings":
        "Settings changed"

      case "restored":
        "Catalog restored"

      default:
        "Catalog changed"
      }
    let recorded = Date(timeIntervalSince1970: TimeInterval(entry.recordedAt))
    return VStack(alignment: .leading) {
      Text(action)
      if let name = entry.edit.name {
        Text(name)
      } else if let source = entry.edit.revision {
        Text("Restored from revision #\(source)")
      }
      Text(
        "Revision #\(entry.revision) · \(recorded.formatted(date: .abbreviated, time: .shortened))"
      )
      .font(.caption)
      .foregroundStyle(.secondary)
      if let actor = entry.actorID {
        Text("User \(actor)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }

  private func load() async {
    await run { () async throws(APIError) in
      history = try await api.catalogHistory(guild: guild)
    }
  }

  private func openPreview(_ revision: UInt64) async {
    await run { () async throws(APIError) in
      preview = try await api.previewCatalogRestore(revision: revision, guild: guild)
    }
  }

  private func restore(_ entry: CatalogRestorePreview) async {
    await run { () async throws(APIError) in
      let revision = try await api.restoreCatalog(entry, guild: guild)
      await onRestore()
      do {
        history = try await api.catalogHistory(guild: guild)
        message = String(localized: "Restore saved as revision #\(revision).")
      } catch {
        history = nil
        message =
          String(localized: "Restore saved as revision #\(revision). Refresh to load history.")
      }
    }
  }

  private func run(_ operation: () async throws(APIError) -> Void) async {
    guard !isBusy else {
      return
    }

    isBusy = true
    preview = nil
    message = nil
    defer { isBusy = false }
    do {
      try await operation()
    } catch {
      message = error.message
    }
  }
}
