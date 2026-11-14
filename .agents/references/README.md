# Implementation references: compact index

Read this index first; load only relevant sections of the linked text snapshots. Summaries are
navigation aids, not replacements for upstream rules. Refresh manually. Sources, retrieval dates,
hashes and licenses are recorded in [manifest](sources.json).

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

Default checklist: validate boundaries; use strong types and explicit errors; keep ownership clear;
document failures and side effects; use reasoned `expect`; test observable behavior; reuse shared
resources; bound work; benchmark optimizations. AI documentation describes current behavior, not
design history. Avoid tests that merely repeat definitions.

Botge exceptions/applicability:

- One unpublished executable: exported-library API compatibility, public trait completeness,
  stable-library compiler support, and workspace inheritance rules do not currently apply.
- No authored macros, FFI ABI, native-handle wrappers, custom collections, or Cargo features: their
  corresponding authoring rules have no surface here. Reassess when introducing one.
- Tests use `cfg(test)` rather than a shipped `test-util` feature; production excludes fixtures.
- Portable AMD64/ARM64 images retain generic CPU targets; stronger targets require host guarantees.
- Two-space indentation is intentional. Explicit internal `Arc` sharing and Tokio are intentional;
  no public runtime-independent library is promised. Default hashers protect untrusted keys.
- Native builds use measured mimalloc; requests retain shared provider snapshots. CPU, page-memory
  and allocator profiles plus future-size budgets are recorded in
  [resource usage](../../docs/RESOURCE_USAGE.md). Synthetic ARM64 results do not establish live
  AMD64 latency or memory bounds. Reassess layout changes with representative measurements.

Snapshots retain their original licenses. API guidelines and Rust documentation are MIT/Apache-2.0;
Design Patterns is MPL-2.0. HTML snapshots are verbatim; `.txt` files are mechanical text extracts.

## Python

Start with the [compact Python baseline](python/README.md) and its [audit](python/AUDIT.md): PEP
8/257, Google Python, Python typing/modernization, Microsoft review guidance and selectively
applicable Azure SDK guidance. Source snapshots and licenses use the same ignored cache and pinned
manifest. Project exceptions and remaining verification gaps are explicit in that baseline.
