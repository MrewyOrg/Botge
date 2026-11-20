import BotgeKit
import Foundation
import Observation

/// One server's voice settings, emote policy and the user's emote border for the Server tab.
///
/// Edits stay in drafts until the user saves; a reload keeps drafts the user changed.
@Observable
final class ServerModel {
  /// The server shown.
  let guild: SharedGuild
  /// The app-wide model, for the API and sign-out.
  let app: AppModel

  /// Saved voice settings and joinable channels; `nil` until loaded or for non-administrators.
  private(set) var voice: VoiceOptions?
  /// Saved emote policy and roles; `nil` until loaded or for non-administrators.
  private(set) var policy: EmotePolicyOptions?
  /// The saved border color, or `nil` for none.
  private(set) var border: BorderColor?
  /// Whether the first load finished, successfully or not.
  private(set) var hasLoaded = false
  /// Whether ``border`` holds a loaded value.
  private(set) var hasLoadedBorder = false
  /// Whether the user administers the server, as Botge last confirmed.
  private(set) var isAdministrator: Bool
  /// Why the last load failed, if it did.
  private(set) var failure: APIError?
  /// Whether a save is in progress.
  private(set) var isSaving = false
  /// The last haptic to play.
  private(set) var haptic: HapticEvent?
  /// Why the last save failed, shown in an alert.
  var saveFailure: String?

  /// The voice settings being edited.
  var voiceDraft: VoiceSettings = .init()
  /// The emote policy being edited.
  var policyDraft: EmotePolicy = .init()
  /// Whether the edited border is on.
  var isBorderEnabled = false
  /// The edited border color, kept while the border is off.
  var borderPick: BorderColor = .white

  /// The border the drafts describe.
  var borderDraft: BorderColor? {
    if isBorderEnabled {
      borderPick
    } else {
      nil
    }
  }

  /// Whether the voice draft differs from the saved settings.
  var isVoiceChanged: Bool {
    voice.map { voiceDraft.normalized != $0.settings.normalized } ?? false
  }

  /// Whether the policy draft differs from the saved policy.
  var isPolicyChanged: Bool {
    policy.map { policyDraft.normalized != $0.policy.normalized } ?? false
  }

  /// Whether the border draft differs from the saved border.
  var isBorderChanged: Bool {
    hasLoadedBorder && borderDraft != border
  }

  /// Whether any draft has unsaved changes.
  var hasChanges: Bool {
    isVoiceChanged || isPolicyChanged || isBorderChanged
  }

  /// Whether Save is available: there are valid changes and no save is running.
  var canSave: Bool {
    hasChanges && !isSaving && voiceDraft.isStatusValid && policyDraft.isValid
  }

  /// Creates a model for one server.
  ///
  /// - Parameters:
  ///   - guild: The server to show.
  ///   - app: The app-wide model.
  init(guild: SharedGuild, app: AppModel) {
    self.guild = guild
    self.app = app
    isAdministrator = guild.isAdministrator
  }

  deinit {
    // Tasks that use the model are owned by the view and end with it.
  }

  /// Loads or reloads everything, keeping drafts the user already changed.
  func load() async {
    guard let api = app.api else {
      return
    }

    let id = guild.id
    let admin = isAdministrator
    async let borderResult = Self
      .fetch { () async throws(APIError) in try await api.borderColor(guild: id) }
    async let voiceResult = Self.fetch { () async throws(APIError) -> VoiceOptions? in
      admin ? try await api.voiceOptions(guild: id) : nil
    }
    async let policyResult = Self.fetch { () async throws(APIError) -> EmotePolicyOptions? in
      admin ? try await api.emotePolicy(guild: id) : nil
    }
    let results = await (borderResult, voiceResult, policyResult)
    guard !Task.isCancelled else {
      return
    }

    do {
      try apply(border: results.0.get(), replacingDraft: false)
      try apply(voice: results.1.get(), replacingDraft: false)
      try apply(policy: results.2.get(), replacingDraft: false)
      failure = nil
    } catch .signedOut {
      await app.signOut()
    } catch .permissionDenied {
      isAdministrator = false
      apply(voice: nil, replacingDraft: true)
      apply(policy: nil, replacingDraft: true)
      failure = nil
    } catch {
      failure = error
    }
    hasLoaded = true
  }

  /// Saves every changed draft, then reports the outcome.
  func save() async {
    guard let api = app.api, canSave else {
      return
    }

    isSaving = true
    defer { isSaving = false }
    do {
      if isVoiceChanged {
        try await apply(voice: api.saveVoice(voiceDraft, guild: guild.id), replacingDraft: true)
      }
      if isPolicyChanged {
        try await apply(
          policy: api.saveEmotePolicy(policyDraft, guild: guild.id),
          replacingDraft: true
        )
      }
      if isBorderChanged {
        try await apply(
          border: api.saveBorderColor(borderDraft, guild: guild.id),
          replacingDraft: true
        )
      }
      play(.success)
    } catch .signedOut {
      await app.signOut()
    } catch {
      saveFailure = error.message
      play(.failure)
    }
  }

  /// Restores every draft to the saved values.
  func discardChanges() {
    apply(voice: voice, replacingDraft: true)
    apply(policy: policy, replacingDraft: true)
    if hasLoadedBorder {
      apply(border: border, replacingDraft: true)
    }
  }

  /// Turns `role` on or off in the manager policy, up to ``EmotePolicy/maxRoles`` roles.
  ///
  /// - Parameter role: The role to toggle.
  func toggle(_ role: GuildRole) {
    if let index = policyDraft.allowedRoleIDs.firstIndex(of: role.id) {
      policyDraft.allowedRoleIDs.remove(at: index)
    } else if policyDraft.allowedRoleIDs.count < EmotePolicy.maxRoles {
      policyDraft.allowedRoleIDs.append(role.id)
    } else {
      // The picker disables further roles at the limit, so this only confirms it.
      play(.failure)
      return
    }
    play(.selection)
  }

  /// Stores loaded voice settings and updates the draft unless the user changed it.
  ///
  /// - Parameters:
  ///   - options: The saved settings, or `nil` when unavailable.
  ///   - replacingDraft: Whether to overwrite a changed draft.
  private func apply(voice options: VoiceOptions?, replacingDraft: Bool) {
    if replacingDraft || !isVoiceChanged {
      voiceDraft = options?.settings ?? VoiceSettings()
    }
    voice = options
  }

  /// Stores a loaded emote policy and updates the draft unless the user changed it.
  ///
  /// - Parameters:
  ///   - options: The saved policy, or `nil` when unavailable.
  ///   - replacingDraft: Whether to overwrite a changed draft.
  private func apply(policy options: EmotePolicyOptions?, replacingDraft: Bool) {
    if replacingDraft || !isPolicyChanged {
      policyDraft = options?.policy ?? EmotePolicy()
    }
    policy = options
  }

  /// Stores the loaded border and updates the draft unless the user changed it.
  ///
  /// The picked color is kept when the border is off, so turning it on again restores it.
  ///
  /// - Parameters:
  ///   - color: The saved border, or `nil` for none.
  ///   - replacingDraft: Whether to overwrite a changed draft.
  private func apply(border color: BorderColor?, replacingDraft: Bool) {
    if replacingDraft || !isBorderChanged {
      isBorderEnabled = color != nil
      if let color {
        borderPick = color
      }
    }
    border = color
    hasLoadedBorder = true
  }

  /// Runs `operation` and captures its outcome.
  ///
  /// - Parameter operation: An API call.
  /// - Returns: The value or the failure.
  private static func fetch<Value: Sendable>(
    _ operation: sending APICall<Value>
  )
    async -> Result<Value, APIError>
  {
    do {
      return try await .success(operation())
    } catch {
      return .failure(error)
    }
  }

  /// Plays a haptic; the view checks the user's haptics setting.
  ///
  /// - Parameter kind: What happened.
  private func play(_ kind: HapticEvent.Kind) {
    haptic = HapticEvent(kind, after: haptic)
  }
}
