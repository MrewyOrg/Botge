import BotgeKit
import SwiftUI

/// Version, legal documents and the source link.
struct AboutView: View {
  /// Botge's source repository.
  private static let sourceURL: URL = .init(literal: "https://github.com/MrewyOrg/Botge")

  var body: some View {
    Form {
      Section {
        LabeledContent(
          "Version",
          value: Self.version(from: Bundle.main.object(forInfoDictionaryKey:))
        )
        .accessibilityIdentifier("about.version")
      }
      Section("Legal") {
        NavigationLink("Terms of Service") {
          LegalDocumentView(title: "Terms of Service", resource: "TERMS", fileExtension: "md")
        }
        NavigationLink("Privacy Policy") {
          LegalDocumentView(title: "Privacy Policy", resource: "PRIVACY", fileExtension: "md")
        }
        NavigationLink("License") {
          LegalDocumentView(title: "License", resource: "LICENSE", fileExtension: "txt")
        }
      }
      Section {
        Link(destination: Self.sourceURL) {
          Label("Source Code", systemImage: "chevron.left.forwardslash.chevron.right")
        }
      }
    }
    .navigationTitle("About & Legal")
  }

  /// The version and build, such as `6.0.0 (1)`.
  ///
  /// - Parameter value: Looks up an Info.plist value by key.
  /// - Returns: The version text, with `?` for a missing value.
  static func version(from value: (String) -> Any?) -> String {
    let marketing = value("CFBundleShortVersionString") as? String ?? "?"
    let build = value("CFBundleVersion") as? String ?? "?"
    return "\(marketing) (\(build))"
  }
}
