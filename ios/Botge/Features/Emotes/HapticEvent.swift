import SwiftUI

/// One haptic to play; a new ``serial`` plays the same kind again.
struct HapticEvent: Equatable {
  /// What happened.
  enum Kind {
    /// Something was added to the composition.
    case impact
    /// An action failed or was refused.
    case failure
    /// The selection changed.
    case selection
    /// An action finished.
    case success
    /// An action partly failed.
    case warning
  }

  /// What happened.
  let kind: Kind
  /// Increases with every event.
  let serial: Int

  /// The system feedback for ``kind``.
  var feedback: SensoryFeedback {
    switch kind {
    case .failure:
      .error

    case .impact:
      .impact(weight: .light)

    case .selection:
      .selection

    case .success:
      .success

    case .warning:
      .warning
    }
  }
}
