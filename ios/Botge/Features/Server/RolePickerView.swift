import BotgeKit
import SwiftUI

/// Chooses the roles whose members may manage emotes.
///
/// Saved roles the server no longer lists stay visible so they can be removed.
struct RolePickerView: View {
  /// The server's settings state.
  let model: ServerModel

  var body: some View {
    let roles = model.policy?.choices ?? []
    List {
      Section {
        ForEach(roles) { role in
          Button {
            model.toggle(role)
          } label: {
            HStack {
              Text(role.name)
                .foregroundStyle(.primary)
              Spacer()
              if model.policyDraft.allowedRoleIDs.contains(role.id) {
                Image(systemName: "checkmark")
                  .foregroundStyle(.tint)
                  .fontWeight(.semibold)
                  .accessibilityHidden(true)
              }
            }
            .contentShape(.rect)
          }
          // At the limit, unchosen roles are dimmed until one is removed.
          .disabled(
            !model.policyDraft.allowedRoleIDs.contains(role.id)
              && model.policyDraft.allowedRoleIDs.count >= EmotePolicy.maxRoles
          )
          .accessibilityAddTraits(
            model.policyDraft.allowedRoleIDs.contains(role.id) ? .isSelected : []
          )
          .accessibilityIdentifier("role.\(role.id)")
        }
      } footer: {
        Text("Choose up to \(EmotePolicy.maxRoles) roles. Save on the Server tab to apply.")
      }
    }
    .overlay {
      if roles.isEmpty {
        ContentUnavailableView(
          "No Roles",
          systemImage: "person.badge.key",
          description: Text("This server has no roles Botge can offer.")
        )
      }
    }
    .navigationTitle("Manager Roles")
    .navigationBarTitleDisplayMode(.inline)
  }
}
