import BotgeKit
import SwiftUI

/// Who besides administrators may add and remove emotes.
struct EmoteManagersSection: View {
  /// The server's settings state.
  @Bindable private var model: ServerModel

  var body: some View {
    Section {
      Toggle(isOn: $model.policyDraft.allowsEveryone) {
        Label("Everyone", systemImage: "person.3")
      }
      .accessibilityIdentifier("server.managers.everyone")
      NavigationLink {
        RolePickerView(model: model)
      } label: {
        LabeledContent {
          Text(model.policyDraft.allowedRoleIDs.count, format: .number)
        } label: {
          Label("Roles", systemImage: "person.badge.key")
        }
      }
      .accessibilityIdentifier("server.managers.roles")
    } header: {
      Text("Emote Managers")
    } footer: {
      Text("Administrators can always add and remove emotes.")
    }
  }

  /// Creates the section.
  ///
  /// - Parameter model: The server's settings state.
  init(model: ServerModel) {
    self.model = model
  }
}
