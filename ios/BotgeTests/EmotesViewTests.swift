@testable import Botge
import BotgeKit
import SwiftUI
import Testing
import ViewInspector

struct EmotesViewTests {
  private static func model(
    _ routes: [String: [RoutedTransport.Reply]] = [:],
    loaded: Bool = true
  )
    async -> EmotesModel
  {
    let app = await Fixtures.signedIn(transport: RoutedTransport(routes))
    let model = EmotesModel(guild: Fixtures.guild, app: app)
    if loaded {
      await model.load()
    }
    return model
  }

  @Test
  func `content shows failures, loading, empty states and the grid`() async throws {
    let failed = await Self.model(["catalog": [.failure(.timedOut)]])
    try failed.inspectContent().find(button: "Try Again").tap()
    let loading = await Self.model(loaded: false)
    #expect(throws: Never.self) { try loading.inspectContent().find(ViewType.ProgressView.self) }

    let model = await Self.model()
    #expect(throws: Never.self) { try model.inspectContent().find(EmoteGrid.self) }
    model.filter.query = "zzz"
    #expect(throws: Never.self) {
      try model.inspectContent().find(ViewType.ContentUnavailableView.self)
    }
    model.filter.query = ""
    model.filter.motion = .still
    model.filter.overlay = .overlaying
    try model.inspectContent().find(button: "Clear Filters").tap()
    #expect(model.filter.activeCount == 0)

    let none = #"{"emotes":[],"canManageEmotes":false,"canComposeDiscovery":false}"#
    let empty = await Self.model(["catalog": [.json(status: 200, body: none)]])
    #expect(throws: Never.self) { try empty.inspectContent().find(text: "No Emotes") }
    empty.source = .discovery(.top)
    #expect(throws: Never.self) { try empty.inspectContent().find(ViewType.ProgressView.self) }
    empty.discoveries[.top] = DiscoveryState(page: 1)
    #expect(throws: Never.self) { try empty.inspectContent().find(text: "7TV returned no emotes.") }
    empty.discoveries[.top]?.failure = .network
    #expect(throws: Never.self) { try empty.inspectContent().find(button: "Try Again") }
  }

  @Test
  func `cells preview or select their emote`() async throws {
    let model = await Self.model()
    let cell = EmoteCell(emote: Fixtures.added, model: model, source: .server)
      .environment(model.app)
    try cell.inspect().find(ViewType.Button.self).tap()
    #expect(model.sheet == .preview(Fixtures.added))
    model.isSelecting = true
    try cell.inspect().find(ViewType.Button.self).tap()
    #expect(model.selection == [Fixtures.added.id])
    model.requestRemoval(of: Fixtures.added)
    #expect(model.pendingRemoval?.id == Fixtures.added.id)
    #expect(throws: Never.self) {
      try EmoteTile(emote: Fixtures.added, isSelected: false, isSelecting: false)
        .environment(model.app)
        .inspect()
        .find(ViewType.Text.self)
    }
    let selected = try EmoteTile(emote: Fixtures.added, isSelected: true, isSelecting: true)
      .environment(model.app)
      .inspect()
    #expect(throws: Never.self) { try selected.find(ViewType.Image.self) }
  }

  @Test
  func `actions compose, copy, share and change the server`() async throws {
    let model = await Self.model(["/emotes": [.json(status: 200, body: #"{"message":"Added."}"#)]])
    var removals = 0
    let actions = EmoteActions(emote: Fixtures.added, model: model) { _ in removals += 1 }
    try actions.inspect().find(button: "Add to Composition").tap()
    #expect(model.composition.layers.count == 1)
    try actions.inspect().find(button: "Copy Name").tap()
    #expect(UIPasteboard.general.string == "peepoHey")
    #expect(throws: Never.self) { try actions.inspect().find(ViewType.ShareLink.self) }
    try actions.inspect().find(button: "Remove from Server").tap()
    #expect(removals == 1)

    let adding = EmoteActions(emote: Fixtures.discovered, model: model) { _ in
      // Discovered emotes cannot be removed.
    }
    try adding.inspect().find(button: "Add to Server").tap()
    await Fixtures.wait { model.haptic?.kind == .success }
    #expect(model.haptic?.kind == .success)
  }

  @Test
  func `the selection bar applies the batch action`() async throws {
    let model = await Self.model()
    #expect(throws: (any Error).self) {
      try SelectionBar(model: model).inspect().find(ViewType.Button.self)
    }
    model.isSelecting = true
    model.toggleSelection(Fixtures.added)
    try SelectionBar(model: model).inspect().find(ViewType.Button.self).tap()
    await Fixtures.wait { model.pendingRemoval != nil }
    #expect(model.pendingRemoval?.id == "selection|1")
    model.source = .discovery(.top)
    #expect(throws: Never.self) {
      try SelectionBar(model: model).inspect().find(ViewType.Button.self)
    }
  }

  @Test
  func `the filter menu edits and clears filters`() throws {
    var filter = EmoteFilter()
    filter.query = "cat"
    filter.motion = .animated
    let binding = Binding { filter } set: { filter = $0 }
    let menu = EmoteFilterMenu(filter: binding, isServerCatalog: true)
    #expect(throws: Never.self) { try menu.inspect().find(ViewType.Toggle.self) }
    try menu.inspect().find(button: "Clear Filters").tap()
    #expect(filter.activeCount == 0 && filter.query == "cat")
    let ranking = EmoteFilterMenu(filter: binding, isServerCatalog: false)
    #expect(throws: (any Error).self) { try ranking.inspect().find(ViewType.Toggle.self) }
  }

  @Test
  func `the source picker ends selection when the source changes`() async throws {
    let model = await Self.model()
    model.isSelecting = true
    try EmotesSourcePicker(model: model).inspect().find(ViewType.Picker.self).callOnChange(
      oldValue: EmotesSource.server,
      newValue: EmotesSource.discovery(.top)
    )
    #expect(!model.isSelecting)
  }

  @Test
  func `the composer edits, copies and clears the composition`() async throws {
    let model = await Self.model()
    let overlay = CatalogEmote(
      name: "RainTime",
      source: .sevenTV,
      image: "/7tv-cdn/emote/O/2x.webp",
      isAnimated: false,
      isOverlay: true,
      composeToken: "RainTime",
      sevenTVID: "O"
    )
    model.compose(Fixtures.added)
    model.compose(Fixtures.added)
    model.compose(overlay)
    let binding = Binding { model.composition } set: { model.composition = $0 }
    let composer = ComposerView(composition: binding)
    try composer.inspect().find(button: "Copy").tap()
    #expect(UIPasteboard.general.string == model.composition.commandText)
    try composer.inspect().find(ViewType.ForEach.self).callOnMove(IndexSet(integer: 0), 2)
    try composer.inspect().find(ViewType.ForEach.self).callOnDelete(IndexSet([0, 1]))
    #expect(model.composition.layers.count == 1)
    try composer.inspect().find(button: "Clear").tap()
    try composer.inspect().find(button: "Done").tap()
    #expect(throws: Never.self) {
      try ComposerPreview(columns: []).inspect().find(ViewType.Text.self)
    }
  }

  @Test
  func `failures show in an alert that clears when dismissed`() throws {
    var failure: String? = "Not a manager."
    let binding = Binding { failure } set: { failure = $0 }
    let alert = try Text("Emotes").failureAlert(binding).inspect().text().alert()
    #expect(try alert.title().string() == "Not a manager.")
    try alert.actions().button(0).tap()
    try alert.dismiss()
    #expect(failure == nil)
  }

  @Test
  func `the preview shows details and confirms removal`() async throws {
    let model = await Self.model()
    let tagged = model.catalog?.emotes.first ?? Fixtures.added
    let preview = EmotePreviewView(opened: tagged, model: model)
    let shown = preview.environment(model.app)
    #expect(throws: Never.self) { try shown.inspect().find(text: "wave") }
    try shown.inspect().find(button: "Remove from Server").tap()
    try shown.inspect().find(ViewType.Button.self) { try $0.role() == .close }.tap()
    model.source = .discovery(.top)
    let plain = EmotePreviewView(opened: Fixtures.discovered, model: model).environment(model.app)
    #expect(throws: (any Error).self) { try plain.inspect().find(text: "Source") }
    #expect(throws: Never.self) { try preview.removalMessage().inspect().text() }
    try preview.removalActions().inspect().button().tap()
    await Fixtures.wait { model.haptic != nil }
    let unloaded = await Self.model(loaded: false)
    #expect(throws: Never.self) {
      try EmotePreviewView(opened: Fixtures.added, model: unloaded)
        .environment(unloaded.app)
        .inspect()
        .find(text: "peepoHey")
    }
    await Hosting.show(preview, model: model.app)
  }

  @Test
  func `the grid pages discovery, refreshes, and shows loading below`() async throws {
    let model = await Self.model()
    model.source = .discovery(.top)
    await model.syncDiscovery()
    let grid = EmoteGrid(model: model, emotes: model.visibleEmotes, source: model.source)
      .environment(model.app)
    let last = try #require(model.visibleEmotes.last)
    try grid.inspect()
      .find(EmoteCell.self) { try $0.actualView().emote == last }
      .callOnAppear()
    nonisolated(unsafe) let scroll = try grid.inspect().find(ViewType.ScrollView.self)
    try await scroll.callRefreshable()
    model.discoveries[.top]?.isLoading = true
    #expect(throws: Never.self) { try grid.inspect().find(ViewType.ProgressView.self) }
  }

  @Test
  func `removals ask for confirmation at the tile or the selection bar`() async throws {
    let model = await Self.model()
    let cell = EmoteCell(emote: Fixtures.added, model: model, source: .server)
      .environment(model.app)
    model.pendingRemoval = .single(Fixtures.added)
    let single = try cell.inspect()
      .find(EmoteCell.self)
      .button()
      .modifier(RemovalConfirmation.self)
      .viewModifierContent()
      .confirmationDialog()
    try single.find(button: "Remove").tap()
    model.isSelecting = true
    model.pendingRemoval = .selection(count: 1)
    let bar = SelectionBar(model: model).environment(model.app)
    let batch = try bar.inspect()
      .find(SelectionBar.self)
      .button()
      .modifier(RemovalConfirmation.self)
      .viewModifierContent()
      .confirmationDialog()
    try batch.dismiss()
    #expect(model.pendingRemoval == nil)
  }

  @Test
  func `the tab loads, applies searches and presents sheets`() async {
    let app = await Fixtures.signedIn()
    app.pendingSearch = "pee"
    let model = EmotesModel(guild: Fixtures.guild, app: app)
    let view = NavigationStack { EmotesView(model: model) }
    await Hosting.show(view, model: app, settle: .milliseconds(600)) {
      #expect(model.filter.query == "pee" && model.source == .server)
      #expect(model.catalog != nil)
      model.play(.success)
      model.source = .discovery(.trending)
      try? await Task.sleep(for: .milliseconds(600))
      Self.scrollEveryScrollView()
      model.sheet = .composer
    }
    #expect(app.pendingSearch == nil)
  }
}

extension EmotesViewTests {
  /// How far ``scrollEveryScrollView()`` scrolls, in points.
  private static let scrollDistance: CGFloat = 400

  /// Scrolls every scroll view on screen, as a user would.
  private static func scrollEveryScrollView() {
    let windows = UIApplication.shared
      .connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
    var views: [UIView] = windows
    while let view = views.popLast() {
      if let scroll = view as? UIScrollView {
        scroll.setContentOffset(CGPoint(x: 0, y: scrollDistance), animated: false)
      }
      views += view.subviews
    }
  }
}

extension EmotesModel {
  /// The content view for this model, ready to inspect.
  ///
  /// - Throws: An inspection error when the content cannot be found.
  func inspectContent() throws -> InspectableView<ViewType.View<EmotesContent>> {
    try EmotesContent(model: self, source: source)
      .environment(app)
      .inspect()
      .find(EmotesContent.self)
  }
}
