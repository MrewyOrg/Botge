# Swift references: compact baseline

Reviewed 2026-11-19. Read this index first; load only relevant cached sections. These are original
navigation summaries, not substitutes for upstream rules. The [audit](AUDIT.md) maps each rule to
the check that enforces it. Full snapshots are ignored; source URLs, revisions and SHA-256 hashes
are tracked in the [manifest](../sources.json). From the repository root, run
`python3 .agents/scripts/cache_references.py` if needed, or add `--check` for offline verification.
Builds and CI never fetch reference snapshots. Refresh manually after reviewing upstream changes.

## Sources

- [API Design Guidelines](../cache/swift-api-design-guidelines.md):
  [naming, labels and documentation](https://www.swift.org/documentation/api-design-guidelines/).
- [Google Swift Style Guide](../cache/swift-google-style.md):
  [formatting and naming](https://google.github.io/swift/).
- Swift 6 concurrency migration guide:
  [data-race safety](../cache/swift-concurrency-DataRaceSafety.md),
  [common problems](../cache/swift-concurrency-CommonProblems.md),
  [incremental adoption](../cache/swift-concurrency-IncrementalAdoption.md) and
  [runtime behavior](../cache/swift-concurrency-RuntimeBehavior.md);
  [published guide](https://www.swift.org/migration/documentation/migrationguide/).
- Apple Human Interface Guidelines, text extracts: [tab bars](../cache/hig-tab-bars.txt),
  [settings](../cache/hig-settings.txt), [accounts](../cache/hig-managing-accounts.txt),
  [haptics](../cache/hig-playing-haptics.txt), [dark mode](../cache/hig-dark-mode.txt),
  [accessibility](../cache/hig-accessibility.txt),
  [Live Activities](../cache/hig-live-activities.txt),
  [App Shortcuts](../cache/hig-app-shortcuts.txt) and [privacy](../cache/hig-privacy.txt);
  [published HIG](https://developer.apple.com/design/human-interface-guidelines/).

## Working rules

Name by role and read call sites as English phrases; label arguments so calls stay clear; prefer
methods and properties to free functions; document every declaration with `///`, starting with a
summary sentence, and list `- Throws:` for throwing APIs. Use value types, `let`, `private`, typed
throws and `Sendable` models; keep shared mutable state in actors or the main actor. Validate
external input at boundaries (configuration, OAuth callbacks, API and image bytes). Never force
unwrap or force try. Keep views small and stateless where possible; state lives in `@Observable`
models. Follow the HIG for navigation, settings, sign-in, haptics, both appearances, Dynamic Type
and VoiceOver.

The iOS app keeps working in Lockdown Mode: no WebKit or Safari views, natively rendered documents,
and image decoding that falls back to a first frame and then a placeholder.

## Botge deviations

- **Two spaces, 100 columns, no trailing commas.** The Google guide and Swift's own sources use two
  spaces; Botge also matches Prettier's 100 columns and `trailingComma: 'none'` instead of Swift's
  usual trailing commas.
- **Documentation at every access level.** Like Rust's denied `missing_docs` with private items
  checked, every declaration is documented. Test functions are exempt, as in Rust.
- **Parameter and Returns tags.** Following Google, functions document parameters and results with
  `- Parameter(s):` and `- Returns:` unless the comment names the parameter in backticks or the
  summary starts with "Returns" or "Whether". `scripts/check_swift_docs.py` enforces this.
- **`random()` factories.** `PKCE.random()` follows the standard library's `random(in:)` naming
  rather than the `make` prefix; other factories start with `make`.
- **One type per file.** SwiftLint's `one_declaration_per_file` applies; small private helpers move
  to their own files.

### Lint exceptions

SwiftLint runs every opt-in rule with `--strict`. These are disabled in `ios/.swiftlint.yml`:

| Rule                         | Reason                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `explicit_acl`               | Contradicts SwiftFormat's redundant-`internal` removal.         |
| `explicit_top_level_acl`     | Same conflict for top-level declarations.                       |
| `explicit_type_interface`    | Contradicts `redundant_type_annotation` and inferred locals.    |
| `explicit_enum_raw_value`    | String raw values equal to case names are idiomatic.            |
| `contrasted_opening_brace`   | Contradicts `opening_brace` and SwiftFormat's same-line braces. |
| `no_grouping_extension`      | Protocol conformances in extensions are the Swift convention.   |
| `prefixed_toplevel_constant` | Swift API guidelines name constants without a `k` prefix.       |
| `prefer_nimble`              | Botge uses Swift Testing, not the Nimble library.               |

Adjusted rules: `attributes` allows property wrappers with arguments on the same line, as
SwiftFormat writes them; `opening_brace` accepts SwiftFormat's brace after a wrapped signature;
`trailing_comma` forbids trailing commas; test targets disable `missing_docs`.

### Formatter exceptions

SwiftFormat opt-in rules left off in `ios/.swiftformat`: `organizeDeclarations`, `markTypes` and
`sortSwitchCases` (SwiftLint's `type_contents_order` and `sorted_enum_cases` own ordering);
`wrapSwitchCases`, `wrapClosureBodies`, `wrapDoBodies` and `wrapSingleLineStrings` (they fight
`blankLineAfterSwitchCase` and short closures); `preferExplicitFalse` (contradicts the API
guidelines' `!` usage); `preferLazyMap` (eager collections are clearer at this size); `urlMacro` (no
macro dependency).

## Provenance and licenses

Text snapshots retain original bytes and notices; no upstream text was edited. Revisions are pinned:

| Publisher                         | Revision       | License    |
| --------------------------------- | -------------- | ---------- |
| swift.org (API Design Guidelines) | `a821e2d48535` | Apache 2.0 |
| Google Swift Style Guide          | `79459b39f2ab` | Apache 2.0 |
| Swift Migration Guide             | `949b5e1be201` | Apache 2.0 |
| Apple HIG (DocC JSON, current)    | checksum only  | Apple ©    |

License files: [swift.org](../cache/SWIFT-ORG-LICENSE.txt),
[Google](../cache/SWIFT-GOOGLE-LICENSE.txt),
[migration guide](../cache/SWIFT-MIGRATION-GUIDE-LICENSE.txt). Apple's HIG content is Apple's
copyright: it is cached locally for reference only, never committed or redistributed, and this index
summarizes it without reproducing it.
