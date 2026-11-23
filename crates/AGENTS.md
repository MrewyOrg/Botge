# Rust guidance

These rules add to the [root guidance](../AGENTS.md) for the Rust workspace. rustfmt, Clippy (`all`,
`pedantic`, `nursery`, `cargo` and selected restriction lints) and Rustdoc lints enforce the rest.
The [workspace guide](README.md) owns the crate dependency policy, which
`botge/tests/architecture.rs` enforces.

Use the dated nightly from `rust-toolchain.toml` for development and checks; production code must
also build on the stable `rust-version`.

## Project rules

- Keep Discord and Axum in adapters and redb transactions in storage; run blocking database work off
  the async executor. Preserve provider opt-ins and verify membership and permissions before writes.
  Bound requests and rendering.
- Test observable behavior, especially denials, concurrent updates and reconnects. Unit tests live
  beside modules in `tests.rs`; integration suites live under `tests/`.
- Benchmark performance changes. New environment options go in `.env.example`, and runtime defaults,
  schemas, examples and docs stay aligned.

## Guideline checklist

Clippy cannot judge these. Each names its rule in the cached
[Microsoft guidelines](../.agents/references/cache/microsoft.txt) (`M-`) or
[Rust API guidelines](../.agents/references/cache/api-guidelines.txt) (`C-`); read that one section
when a case is unclear (`python3 .agents/scripts/cache_references.py` fetches a missing cache).

- **Names:** short, by role, consistent word order, no weasel words such as `Manager` or `Util`
  (M-SHORT-NAMES, M-WEASEL-WORDS, C-WORD-ORDER). Conversions and getters follow `as_`/`to_`/`into_`
  and drop `get_` (C-CONV, C-GETTER).
- **Types carry meaning:** newtypes guard their invariants; arguments use types, not `bool` or
  `Option` flags (M-STRONG-TYPES-GUARD, M-STRONG-TYPES, C-NEWTYPE, C-CUSTOM-TYPE).
- **API shape:** functions with a clear receiver are methods, constructors are inherent, essential
  operations are inherent and parameter order is consistent (C-METHOD, C-CTOR,
  M-ESSENTIAL-FN-INHERENT, M-PARAMETER-CONSISTENCY). Prefer concrete types to generics and generics
  to `dyn`; keep wrappers and nested abstractions out of signatures (M-DI-HIERARCHY,
  M-AVOID-WRAPPERS, M-SIMPLE-ABSTRACTIONS).
- **Paths:** each item has one path; no glob re-exports or preludes, and `pub use` items are
  `#[doc(inline)]` (M-SINGLE-ITEM-PATH, M-NO-GLOB-REEXPORTS, M-NO-PRELUDE, M-DOC-INLINE).
- **Traits:** public types are `Debug` with a useful representation, `Display` when people read
  them, and `Send` where possible; conversions use `From`/`AsRef` (M-PUBLIC-DEBUG, M-PUBLIC-DISPLAY,
  M-TYPES-SEND, C-CONV-TRAITS, M-FROM-ERROR).
- **Errors and panics:** library errors are meaningful types; panics mark detected bugs and carry a
  helpful message, never recoverable input (C-GOOD-ERR, M-ERRORS-CANONICAL-STRUCTS, M-PANIC-ON-BUG,
  M-PANIC-MESSAGE).
- **Docs:** a one-line first sentence of about 15 words, module docs that explain purpose,
  documented magic values, and failure, panic and side-effect notes with links to related items
  (M-FIRST-DOC-SENTENCE, M-MODULE-DOCS, M-DOCUMENTED-MAGIC, C-FAILURE, C-LINK). Comments describe
  current behavior, never design history (M-NO-META-DESIGN-DOCUMENTATION).
- **Runtime:** long-running async work has yield points, statics hold no business state, and I/O is
  mockable in tests (M-YIELD-POINTS, M-AVOID-STATICS, M-MOCKABLE-SYSCALLS). Logs are structured with
  message templates (M-LOG-STRUCTURED).
- **Performance:** find the hot path, size collections up front and reuse allocations there
  (M-HOTPATH, M-INITIAL-CAPACITY, M-MEM-REUSE).
- **Tests:** never restate definitions; test utilities stay feature-gated (M-TAUTOLOGICAL-TESTS,
  M-TEST-UTIL).

## Botge deviations

These private crates build one application, so library-publishing rules (stable public APIs,
`C-STABLE`, `C-METADATA`, release notes) do not apply, and macro, FFI and `unsafe` rules have no
surface (`unsafe_code` is forbidden). Deliberate choices that differ from the guidelines:

- Application errors use `anyhow` (M-APP-ERROR). Access failure categories are an internal adapter
  protocol, not an extensible error API; expected denials keep static messages without backtraces.
- Sharing uses explicit `Arc` rather than cloneable service handles (M-SERVICES-CLONE).
- HTTP-client statics cache connections, never business state.
- Trait methods return `impl Future + Send` to state the executor requirement (M-ASYNC-FN).
- The application's `Catalog` and `Layer` exports form its small facade; other consumers import
  owning crates directly.
- Default hashers stay, because they protect untrusted keys (M-FAST-HASHER).
- Native builds use measured mimalloc and generic CPU targets for portable AMD64 and ARM64 images
  (M-MIMALLOC-APPS, M-TARGET-CPU). Profiles and budgets are in
  [resource usage](../docs/RESOURCE_USAGE.md); synthetic ARM64 results do not establish AMD64
  latency or memory, so reassess layout changes with representative measurements.
