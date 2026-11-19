import SwiftUI

/// Version, legal documents and the source link.
struct AboutView: View {
  private static let sourceURL: URL? = URL(string: "https://github.com/MrewyOrg/Botge")

  private static var version: String {
    let info = Bundle.main.infoDictionary
    let marketing = info?["CFBundleShortVersionString"] as? String ?? "?"
    let build = info?["CFBundleVersion"] as? String ?? "?"
    return "\(marketing) (\(build))"
  }

  var body: some View {
    Form {
      Section {
        LabeledContent("Version", value: Self.version)
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
      if let url = Self.sourceURL {
        Section {
          Link(destination: url) {
            Label("Source Code", systemImage: "chevron.left.forwardslash.chevron.right")
          }
        }
      }
    }
    .navigationTitle("About & Legal")
  }
}
