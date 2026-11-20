@testable import Botge
import BotgeKit
import Foundation
import Testing

struct ServerModelTests {
  private static let channel = "200000000000000001"
  private static let role: GuildRole = .init(id: "300000000000000001", name: "Moderators")
  private static let signedOutReply = RoutedTransport.Reply.json(
    status: 401,
    body: #"{"message":"no"}"#
  )

  private static func model(
    _ routes: [String: [RoutedTransport.Reply]] = [:],
    guild: SharedGuild = Fixtures.guild
  )
    async -> ServerModel
  {
    let app = await Fixtures.signedIn(transport: RoutedTransport(routes))
    let model = ServerModel(guild: guild, app: app)
    await model.load()
    return model
  }

  @Test
  func `administrators load voice, policy and border settings`() async {
    let model = await Self.model()
    #expect(model.hasLoaded && model.hasLoadedBorder && model.isAdministrator)
    #expect(model.voice?.choices.map(\.id) == [Self.channel])
    #expect(model.policy?.choices == [Self.role])
    #expect(model.border == nil && !model.isBorderEnabled)
    #expect(!model.hasChanges && !model.canSave)
  }

  @Test
  func `members load only their border`() async {
    let model = await Self.model(guild: Fixtures.memberGuild)
    #expect(model.voice == nil && model.policy == nil)
    #expect(model.hasLoadedBorder)
  }

  @Test
  func `a refused administrator becomes a member and failures are kept`() async {
    let refused = await Self.model(["/settings": [.json(status: 403, body: #"{"message":"No."}"#)]])
    #expect(!refused.isAdministrator)
    #expect(refused.failure == nil && refused.voice == nil)
    let offline = await Self.model(["border/read": [.failure(.notConnectedToInternet)]])
    #expect(offline.failure == .network)
    #expect(offline.hasLoaded)
    let expired = await Self.model(["emotes/read": [Self.signedOutReply]])
    #expect(expired.app.phase == .signedOut)
  }

  @Test
  func `a cancelled load changes nothing`() async {
    let app = await Fixtures.signedIn()
    let model = ServerModel(guild: Fixtures.guild, app: app)
    let load = Task { await model.load() }
    load.cancel()
    await load.value
    #expect(!model.hasLoaded)
    let misconfigured = ServerModel(guild: Fixtures.guild, app: Fixtures.misconfigured())
    await misconfigured.load()
    await misconfigured.save()
    #expect(!misconfigured.hasLoaded)
  }

  @Test
  func `every changed draft saves`() async {
    let model = await Self.model()
    model.voiceDraft.channelID = Self.channel
    model.toggle(Self.role)
    model.isBorderEnabled = true
    #expect(model.isVoiceChanged && model.isPolicyChanged && model.isBorderChanged)
    #expect(model.canSave)
    await model.save()
    #expect(model.saveFailure == nil)
    #expect(model.haptic?.kind == .success)
    #expect(model.voice?.settings.channelID == Self.channel)
    #expect(model.policy?.policy.allowedRoleIDs == [Self.role.id])
    #expect(model.border == .white)
    #expect(!model.hasChanges)

    model.toggle(Self.role)
    await model.save()
    #expect(model.saveFailure == nil && !model.hasChanges)
  }

  @Test
  func `failed saves explain why and a rejected login signs out`() async {
    let model = await Self.model(["settings/border": [.failure(.timedOut), Self.signedOutReply]])
    model.isBorderEnabled = true
    await model.save()
    #expect(model.saveFailure == APIError.network.message)
    #expect(model.haptic?.kind == .failure)
    await model.save()
    #expect(model.app.phase == .signedOut)
  }

  @Test
  func `drafts can be discarded and reloads keep changed drafts`() async {
    let model = await Self.model()
    model.voiceDraft.status = "hi"
    model.policyDraft.allowsEveryone = true
    model.isBorderEnabled = true
    model.borderPick = BorderColor(red: 1, green: 2, blue: 3)
    await model.load()
    #expect(model.voiceDraft.status == "hi")
    #expect(model.policyDraft.allowsEveryone)
    #expect(model.borderDraft == BorderColor(red: 1, green: 2, blue: 3))
    model.discardChanges()
    #expect(!model.hasChanges)
    #expect(model.borderPick == BorderColor(red: 1, green: 2, blue: 3))
  }

  @Test
  func `manager roles are capped`() async {
    let model = await Self.model()
    for index in 0 ... EmotePolicy.maxRoles {
      model.toggle(GuildRole(id: "\(400_000_000_000_000_000 + index)", name: "r\(index)"))
    }
    #expect(model.policyDraft.allowedRoleIDs.count == EmotePolicy.maxRoles)
    #expect(model.haptic?.kind == .failure)
  }
}
