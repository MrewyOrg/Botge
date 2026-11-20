@testable import Botge
import SwiftUI
import UIKit

/// Shows views in a real window, so their tasks, state and presentations run.
enum Hosting {
  /// How long a view stays on screen before and after the interaction by default.
  private static let settle: Duration = .milliseconds(settleMilliseconds)
  /// ``settle`` in milliseconds.
  private static let settleMilliseconds = 300

  /// Shows `view` with `model` in its environment for a moment.
  ///
  /// - Parameters:
  ///   - view: The view to show.
  ///   - model: The app model the view reads.
  static func show(_ view: some View, model: AppModel) async {
    await show(view, model: model, settle: settle) {
      // Showing the view is the test.
    }
  }

  /// Shows `view` with `model` in its environment for `settle`.
  ///
  /// - Parameters:
  ///   - view: The view to show.
  ///   - model: The app model the view reads.
  ///   - settle: How long to let tasks and animations run.
  static func show(_ view: some View, model: AppModel, settle: Duration) async {
    await show(view, model: model, settle: settle) {
      // Showing the view is the test.
    }
  }

  /// Shows `view` with `model` in its environment while `interact` runs.
  ///
  /// - Parameters:
  ///   - view: The view to show.
  ///   - model: The app model the view reads.
  ///   - interact: Called while the view is on screen.
  static func show(
    _ view: some View,
    model: AppModel,
    interact: () async -> Void
  )
    async
  {
    await show(view, model: model, settle: settle, interact: interact)
  }

  /// Shows `view` with `model` in its environment, waits `settle` around `interact`, then
  /// removes it.
  ///
  /// - Parameters:
  ///   - view: The view to show.
  ///   - model: The app model the view reads.
  ///   - settle: How long to let tasks and animations run.
  ///   - interact: Called while the view is on screen.
  static func show(
    _ view: some View,
    model: AppModel,
    settle: Duration,
    interact: () async -> Void
  )
    async
  {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    guard let scene else {
      return
    }

    let window = UIWindow(windowScene: scene)
    window.rootViewController = UIHostingController(rootView: view.environment(model))
    window.makeKeyAndVisible()
    try? await Task.sleep(for: settle)
    await interact()
    try? await Task.sleep(for: settle)
    window.isHidden = true
    window.rootViewController = nil
  }
}
