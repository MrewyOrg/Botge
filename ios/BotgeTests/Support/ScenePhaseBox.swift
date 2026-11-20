import Observation
import SwiftUI

/// Holds the scene phase a hosted view sees, so a test can move it to the background and back.
@Observable
final class ScenePhaseBox {
  /// The phase the view sees.
  var value: ScenePhase = .background

  deinit {
    // Nothing to release.
  }
}
