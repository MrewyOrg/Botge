// swift-tools-version: 6.0

// Pins the command-line tools used to generate, format, and lint the iOS app.
// The committed `Package.resolved` makes every machine and CI run use the same versions.

import PackageDescription

/// Tool-only package; it has no targets of its own.
let package = Package(
  name: "BotgeTools",
  platforms: [.macOS(.v15)],
  dependencies: [
    .package(url: "https://github.com/yonaskolb/XcodeGen.git", exact: "2.47.0"),
    .package(url: "https://github.com/nicklockwood/SwiftFormat.git", exact: "0.64.7"),
    .package(url: "https://github.com/SimplyDanny/SwiftLintPlugins.git", exact: "0.65.1")
  ]
)
