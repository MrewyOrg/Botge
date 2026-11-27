# iOS guidance

These rules add to the [root guidance](../AGENTS.md) for the SwiftUI app; the [iOS guide](README.md)
covers setup, signing and troubleshooting, and SwiftFormat and SwiftLint enforce the rest.

Edit `project.yml`, not the generated Xcode project, and regenerate it after adding files. SwiftLint
runs in every build, so even temporary code must pass it.

- Logic belongs in `BotgeKit`, tested with Swift Testing; views stay thin.
- The app must work in Lockdown Mode: no WebKit or Safari views. Measure performance changes on an
  iPhone with Lockdown Mode on, where ImageIO decodes out of process.
- Prefer Apple frameworks, system settings and standard iOS behavior to custom code; keep in-app
  settings only where iOS has none. Destructive actions confirm in a dialog attached to their
  control.

## Guideline checklist

SwiftLint and the compiler cannot judge these. Each names its source in the cached guides listed in
the [Swift reference index](../.agents/references/swift/README.md); read that one section when a
case is unclear (`.venv/bin/python .agents/scripts/cache_references.py` fetches a missing cache).

- **Clarity at the point of use:** names describe roles, not types; call sites read as English
  phrases; omit needless words but never at the cost of clarity (API Design Guidelines:
  Fundamentals, Promote Clear Usage).
- **Fluent usage:** Booleans read as assertions (`isEmpty`), factories start with `make`, methods
  without side effects read as nouns, and mutating and non-mutating pairs follow `sort`/`sorted`
  (Strive for Fluent Usage).
- **Argument labels:** omit the first label only when the call reads as a phrase; label
  prepositional and defaulted arguments (Argument Labels, Parameters).
- **Documentation:** the summary says what a declaration does or returns, not how (Write a
  documentation comment).
- **Concurrency:** shared mutable state lives in actors or the main actor; `@unchecked Sendable`
  only on documented thread-safe types (concurrency guide: Data Race Safety, Common Problems).
- **Navigation and settings:** tab bars for top-level sections only; in-app settings only where iOS
  has none (HIG: tab bars, settings).
- **Accounts and privacy:** sign in through the system sheet; collect and keep only the data the
  feature needs, and disclose it in `docs/PRIVACY.md` (HIG: managing accounts, privacy).
- **Haptics:** system feedback by its documented meaning, short and never the only signal (HIG:
  playing haptics).
- **Accessibility:** works at the largest Dynamic Type size and in both appearances; every control
  has a VoiceOver label and the right traits (HIG: accessibility, dark mode).
- **Live Activities and shortcuts:** Live Activities update only on change and hide private data;
  App Shortcuts use short phrases with the app name (HIG: Live Activities, App Shortcuts).
