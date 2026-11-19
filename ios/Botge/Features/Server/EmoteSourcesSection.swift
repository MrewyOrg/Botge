import BotgeKit
import SwiftUI

/// The 7TV set and the BetterTTV and FrankerFaceZ channels whose emotes the server uses.
struct EmoteSourcesSection: View {
  /// The server's settings state.
  @Bindable private var model: ServerModel

  var body: some View {
    Section {
      field("7TV Set", prompt: "Set ID", text: $model.policyDraft.sevenTVSet.orEmpty)
        .accessibilityIdentifier("server.sources.7tv")
      field(
        "BetterTTV",
        prompt: "Twitch User ID",
        text: $model.policyDraft.betterTTVTwitchID.orEmpty
      )
      .keyboardType(.numberPad)
      .accessibilityIdentifier("server.sources.bttv")
      field("FrankerFaceZ", prompt: "Channel", text: $model.policyDraft.frankerFaceZChannel.orEmpty)
        .accessibilityIdentifier("server.sources.ffz")
    } header: {
      Text("Emote Sources")
    } footer: {
      if problems.isEmpty {
        Text("Leave a source empty to turn it off.")
      } else {
        Text(problems.joined(separator: "\n"))
          .foregroundStyle(.red)
      }
    }
    .textInputAutocapitalization(.never)
    .autocorrectionDisabled()
  }

  /// One line per invalid entry.
  private var problems: [String] {
    let policy = model.policyDraft
    var lines = [String]()
    if !policy.isSevenTVSetValid {
      lines.append(String(localized: "A 7TV set ID has 24 or 26 letters and digits."))
    }
    if !policy.isBetterTTVTwitchIDValid {
      lines.append(String(localized: "A Twitch user ID has only digits."))
    }
    if !policy.isFrankerFaceZChannelValid {
      lines
        .append(String(localized: "A channel name has up to 25 letters, digits and underscores."))
    }
    return lines
  }

  /// Creates the section.
  ///
  /// - Parameter model: The server's settings state.
  init(model: ServerModel) {
    self.model = model
  }

  /// A labelled text field with its value on the trailing side, as in iOS settings.
  ///
  /// - Parameters:
  ///   - title: The row label.
  ///   - prompt: The placeholder.
  ///   - text: The edited value.
  /// - Returns: The row.
  private func field(
    _ title: LocalizedStringResource,
    prompt: LocalizedStringResource,
    text: Binding<String>
  )
    -> some View
  {
    LabeledContent {
      TextField(text: text, prompt: Text(prompt)) {
        Text(title)
      }
      .multilineTextAlignment(.trailing)
    } label: {
      Text(title)
    }
  }
}
