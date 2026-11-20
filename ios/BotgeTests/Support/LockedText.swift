@testable import Botge
import SwiftUI

/// Text under App Lock whose scene phase a test controls.
struct LockedText: View {
  /// The scene phase to show the view in.
  let phase: ScenePhaseBox

  var body: some View {
    Text("Content").appLock().environment(\.scenePhase, phase.value)
  }
}
