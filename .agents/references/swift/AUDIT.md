# Swift reference audit

Reviewed 2026-11-19. Each item names a rule area and how Botge enforces it. "Review" means a
reviewer checks it; everything else fails `npm run check:ios`, the Xcode build or CI.

- **API guidelines: clarity at the point of use:** Review; `identifier_name`, `type_name`.
- **API guidelines: Boolean properties read as assertions, factories start with `make`,
  side-effect-free methods read as noun phrases:** Review (reviewed 2026-11-19).
- **API guidelines and Google: documentation comments and tags:** `missing_docs` (all access
  levels), `scripts/check_swift_docs.py` (Parameter and Returns tags), custom `missing_throws_doc`,
  `missing_doc_comment`, `missing_wrapped_property_docs`.
- **API guidelines: naming by role, labels:** Review; `function_parameter_count`.
- **API guidelines: conventions (case, acronyms):** SwiftFormat `acronyms`; `identifier_name`.
- **Google: formatting, line length, braces:** SwiftFormat (`--indent 2`, `--max-width 100`);
  `line_length`, `opening_brace`.
- **Google: one statement per line, no `;`:** SwiftFormat `--semicolons never`;
  `statement_position`.
- **Google: imports sorted, no unused:** SwiftFormat `sortImports`; `sorted_imports`,
  `unused_import` (analyzer).
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
- **HIG: sign-in with system sheet:** `ASWebAuthenticationSession`; review.
- **HIG: dark mode, Dynamic Type, VoiceOver:** Review; UI tests use accessibility identifiers.
- **HIG: haptics, Live Activities, Shortcuts:** Review when those features land.
- **HIG: privacy:** `PrivacyInfo.xcprivacy`; `docs/PRIVACY.md` review.
- **Lockdown Mode compatibility:** Custom `no_web_content`; `LockdownTests`; `Lockdown.xctestplan`.
- **Logging without leaking data:** Custom `no_print`; review of `Logger` privacy annotations.
- **Tests: Swift Testing for units:** SwiftFormat `preferSwiftTesting`; 90% BotgeKit line coverage
  gate.
