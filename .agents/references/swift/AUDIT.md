# Swift reference audit

Reviewed 2026-11-20. Each item names a rule area and how Botge enforces it. "Review" means a
reviewer checks it; everything else fails `npm run check:ios`, the Xcode build or CI.

- **API guidelines: clarity at the point of use:** Review; `identifier_name`, `type_name`.
- **API guidelines: Boolean properties read as assertions, factories start with `make`,
  side-effect-free methods read as noun phrases:** Review (reviewed 2026-11-19).
- **API guidelines and Google: documentation comments and tags:** `missing_docs` (all access
  levels), `scripts/ios/check_swift_docs.py` (Parameter and Returns tags), custom
  `missing_throws_doc`, `missing_doc_comment`, `missing_wrapped_property_docs`.
- **API guidelines: naming by role, labels:** Review; `function_parameter_count`.
- **API guidelines: conventions (case, acronyms):** SwiftFormat `acronyms`; `identifier_name`.
- **Google: formatting, line length, braces:** SwiftFormat (`--indent 2`, `--max-width 100`);
  `line_length`, `opening_brace`.
- **Google: one statement per line, no `;`:** SwiftFormat `--semicolons never`;
  `statement_position`.
- **Google: imports sorted, no unused:** SwiftFormat `sortImports`; `sorted_imports`. Unused
  imports: review, since the `unused_import` analyzer rule misreports imports the compiler needs.
- **Unused code:** `unused_declaration`, `capture_variable` and `typesafe_array_init` (analyzer,
  `npm run check:ios:analyze` and CI).
- **Google: access control, `final`:** SwiftFormat `preferFinalClasses`, `redundantInternal`;
  `private_over_fileprivate`.
- **Google: no force unwrap or force try:** `force_unwrapping`, `force_try`, `force_cast`,
  `implicitly_unwrapped_optional`.
- **Google: switch and enum style:** `sorted_enum_cases`, SwiftFormat `blankLineAfterSwitchCase`.
- **Concurrency: data-race safety:** Swift 6 language mode, `SWIFT_STRICT_CONCURRENCY: complete`,
  warnings as errors.
- **Concurrency: isolation of UI state:** App targets default to `MainActor`; services are actors.
- **Concurrency: `Sendable` models:** Compiler; `redundantSendable` (SwiftFormat).
- **Concurrency: incremental adoption tools:** Not needed: the app started in Swift 6 mode.
- **HIG: tab bar navigation, settings:** Review; `MainTabView`, `SettingsView`.
- **HIG: sign-in with system sheet:** SwiftUI's `webAuthenticationSession`; review.
- **HIG: dark mode, Dynamic Type, VoiceOver:** Review (reviewed 2026-11-19 at the largest
  accessibility size in both appearances: dense grids cap their growth, rows stack, and fixed sizes
  use `@ScaledMetric`); UI tests use accessibility identifiers.
- **HIG: haptics:** Review (reviewed 2026-11-20): system patterns by their documented meaning and
  short, through `sensoryFeedback`, which follows the system haptics setting; no in-app toggle.
- **HIG: accessibility motion:** Animated emotes follow `accessibilityPlayAnimatedImages` (Auto-Play
  Animated Images); review.
- **HIG: confirmation dialogs:** Review (reviewed 2026-11-20): destructive actions confirm, and each
  dialog is attached to the control that opens it, so it points at that control.
- **HIG: Live Activities:** Review (reviewed 2026-11-19): 14-point Lock Screen margin, medium or
  heavier text, accent tint, a live countdown in the minimal view, updates only on change, a tap
  that opens the Guess tab, and no sensitive data beyond the server name, which `docs/PRIVACY.md`
  discloses; with App Lock on, the server name and score stay in the app.
- **HIG: App Shortcuts:** Review (reviewed 2026-11-19): two short phrases with the app name, a
  follow-up question for a missing search, most useful first, and a `ShortcutsLink` in Settings.
- **HIG: privacy:** `PrivacyInfo.xcprivacy`; `docs/PRIVACY.md` review.
- **Lockdown Mode compatibility:** Custom `no_web_content`; `LockdownTests`; `Lockdown.xctestplan`.
- **Logging without leaking data:** Custom `no_print`; review of `Logger` privacy annotations.
- **Tests: Swift Testing for units:** SwiftFormat `preferSwiftTesting`; 90% line, region and
  function coverage for every Swift file across BotgeKit, the app and the widget extension.
