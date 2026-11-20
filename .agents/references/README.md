# Implementation references: compact index

These indexes record where Botge applies, adapts or skips the upstream guides its linters encode.
Agents need them only when a change touches one of the listed exceptions; the guides themselves are
cached for reference and do not need reading during routine work. Sources, retrieval dates, hashes
and licenses are recorded in the [manifest](sources.json).

## Rust

- [Microsoft](cache/microsoft.txt): applicable M-rules, including AI.
- [API](cache/api-guidelines.txt): names, traits, conversions, contracts, examples.
- [Style](cache/style-guide.txt): formatting through repository rustfmt settings.
- [Patterns](cache/design-patterns.txt): ownership, small abstractions, anti-patterns.
- [Undefined behavior](cache/undefined-behavior.txt): soundness; unsafe remains forbidden.

If a needed snapshot is missing, run `python3 .agents/scripts/cache_references.py`. Use `--check` to
verify cached files offline. Builds/tests never download references. Review upstream changes and
update the manifest manually on a checksum mismatch. Full snapshots and text extracts are ignored by
Git; this index and the manifest are tracked.

Botge's deviations from these guides, and the checklist of rules Clippy cannot judge, are in the
[Rust guidance](../../crates/AGENTS.md).

Snapshots retain their original licenses. API guidelines and Rust documentation are MIT/Apache-2.0;
Design Patterns is MPL-2.0. HTML snapshots are verbatim; `.txt` files are mechanical text extracts.

## Python

The [Python baseline](python/README.md) lists Botge's deviations from PEP 8/257, Google Python,
Python typing and modernization, Microsoft review guidance and selectively applicable Azure SDK
guidance; its [audit](python/AUDIT.md) maps each area to the check that enforces it. Source
snapshots and licenses use the same ignored cache and pinned manifest. Project exceptions and
remaining verification gaps are explicit in that baseline.

## Swift

The [Swift baseline](swift/README.md) lists Botge's deviations from the Swift API Design Guidelines,
the Google Swift Style Guide, the Swift 6 concurrency migration guide and the iOS sections of
Apple's Human Interface Guidelines; its [audit](swift/AUDIT.md) maps each area to its check. HIG
pages are DocC JSON with generated text extracts; they stay in the local cache and are never
committed. Lint and formatter exceptions are listed in that baseline.
