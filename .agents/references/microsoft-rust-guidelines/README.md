# Microsoft Rust guideline snapshot

Offline agent reference for all 90 Microsoft Pragmatic Rust Guidelines, including AI.

- [Complete reference](../cache/microsoft.txt), preserved verbatim from the
  [official agent reference](https://microsoft.github.io/rust-guidelines/agents/all.txt).
- Published version: 2026.6.
- Retrieved: 2026-11-14.
- Upstream repository revision at retrieval:
  [9585e288d21d2da994a0550c926a09b62d79f8bd](https://github.com/microsoft/rust-guidelines/tree/9585e288d21d2da994a0550c926a09b62d79f8bd).
- Copyright Microsoft Corporation; distributed under the
  [MIT license](../cache/MICROSOFT-LICENSE.txt).

SHA-256 of `all.txt`:

```text
e69533b0541a5d185ad9d8304f5eb5cf4b033135b7046f89c499b6126dced3b6
```

Use this local snapshot during Rust work. Its relative upstream links are not local documentation
paths; consult the [official site](https://microsoft.github.io/rust-guidelines/) for linked pages.

Refresh manually when requested or when adopting a newer guideline version. Download the official
agent reference and upstream license, review their changes, update this metadata and checksum, and
run the repository's documentation checks. Builds and CI must not refresh this snapshot.

## Botge applicability

See the [compact index](../README.md) for shared rules and exceptions.

The executable uses private workspace libraries with explicit contracts and inherited lint policy.
Published-library compatibility, macro-authoring and FFI ABI rules have no corresponding surface.
Unit tests use cfg(test); opt-in test-util features share fixtures only with development
dependencies. Portable CPU targets, two-space rustfmt and explicit internal Arc sharing are
deliberate. Measured mimalloc and retained provider snapshots address the current allocation/copying
findings; profiling and future-size budgets are described in
[resource usage](../../../docs/RESOURCE_USAGE.md). These synthetic ARM64 measurements do not
establish live AMD64 performance.

The snapshot and license are optional ignored cache files. If absent, run
`python3 .agents/scripts/cache_references.py` from the repository root. The tracked
[manifest](../sources.json) verifies sources and licenses before storing them.
