import SwiftUI

extension EnvironmentValues {
  /// Whether emotes animate even when the system Auto-Play Animated Images setting is off. Previews
  /// and tests set it, since the system value is read-only and differs between simulators.
  @Entry var forcesEmoteAnimation = false
}
