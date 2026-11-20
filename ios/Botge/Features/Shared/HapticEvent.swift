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

  /// Creates the event after `previous`, with the next serial so it plays even when the kind
  /// repeats.
  ///
  /// - Parameters:
  ///   - kind: What happened.
  ///   - previous: The last event, or `nil` for the first.
  init(_ kind: Kind, after previous: Self?) {
    self.kind = kind
    serial = (previous?.serial ?? 0) + 1
  }
}
