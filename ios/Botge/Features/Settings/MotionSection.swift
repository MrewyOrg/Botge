import BotgeKit
import SwiftUI

/// Haptic feedback and animated-emote playback.
struct MotionSection: View {
  /// Whether haptics play.
  @AppStorage(PreferenceKey.haptics) private var haptics = true
  /// When animated emotes play.
  @AppStorage(PreferenceKey.emotePlayback) private var playback: EmotePlayback = .followReduceMotion

  var body: some View {
    Section("Haptics & Motion") {
      Toggle(isOn: $haptics) {
        Label("Haptics", systemImage: "hand.tap")
      }
      Picker(selection: $playback) {
        Text("Always").tag(EmotePlayback.always)
        Text("Follow Reduce Motion").tag(EmotePlayback.followReduceMotion)
        Text("Never").tag(EmotePlayback.never)
      } label: {
        Label("Animated Emotes", systemImage: "play.square.stack")
      }
    }
  }
}
