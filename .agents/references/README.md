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

- One unpublished executable and private workspace libraries: workspace dependency/lint inheritance
  and explicit public library contracts apply. Published-library compatibility and stable-library
  compiler support are not promised.
- No authored macros, FFI ABI, native-handle wrappers, custom collections or production Cargo
  features: their corresponding authoring rules have no surface here. Reassess when introducing one.
- Unit tests use `cfg(test)`. Explicit `test-util` features expose isolated fixtures to other
  workspace tests; normal production dependencies must not enable them.
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

## Workspace review (2026-11-15)

All crates, including the executable, are siblings under `crates/`; the root is a virtual workspace.

Light review after the crate split: shared metadata/dependency versions/lints, sibling layout,
authorization and storage ownership, safe async/blocking boundaries, bounded work, public Rustdoc,
redacted debugging, error interoperability, and fixture isolation were checked. Re-exports of owned
items inline their documentation. Application access failures implement standard error/display
traits while preserving sanitized messages.

Retained choices: these private libraries build one application and use `anyhow`, Tokio, URL and
narrow sibling types directly. The application's `Catalog`/`Layer` exports form its small service
facade rather than a compatibility tree; consumers otherwise import owning crates. Access failure
categories are an internal adapter protocol, not a published extensible error API; expected denials
retain static messages without a separate backtrace. `Arc` sharing is explicit rather than adding
clone-handle wrappers. HTTP-client statics cache connections, not business state. Trait methods use
return-position `impl Future + Send` to state the executor requirement. Lifecycle tests need private
binary wiring; public CLI/dependency integration tests remain under `tests/`. Performance claims
remain limited to measured targets. This review is not a claim of blanket guideline compliance.
