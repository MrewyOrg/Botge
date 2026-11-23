# Rust references

These five references guide the Rust workspace. The [audit](AUDIT.md) records how Botge applies each
guide and subguide. The [crate guidance](../../../crates/AGENTS.md) owns the checklist and project
deviations. [Resource usage](../../../docs/RESOURCE_USAGE.md) records the measurements behind
Botge's allocator and CPU target choices.

## Sources

- [Microsoft Pragmatic Rust Guidelines](../cache/microsoft.txt), including the AI subguide. This is
  the complete upstream agent reference for version 2026.6, retrieved 2026-11-14 at [revision
  `9585e288d21d`][microsoft-revision]. Microsoft publishes it under the
  [MIT license](../cache/MICROSOFT-LICENSE.txt).
- [Rust API Guidelines](../cache/api-guidelines.txt) for naming, traits, conversions, and contracts.
- [Rust Style Guide](../cache/style-guide.txt) for formatting through rustfmt.
- [Rust Design Patterns](../cache/design-patterns.txt) for ownership, abstractions, and
  anti-patterns.
- [Rust undefined behavior reference](../cache/undefined-behavior.txt) for soundness. The workspace
  forbids unsafe code.

The [manifest](../sources.json) records the source URLs and SHA-256 checksums. The Rust API
Guidelines and Rust documentation use MIT/Apache-2.0. Rust Design Patterns uses MPL-2.0.

## Reference cache

From the repository root, run `python3 .agents/scripts/cache_references.py` to populate the ignored
cache or add `--check` to verify it offline. Refresh snapshots manually after reviewing upstream
changes and update the manifest when adopting a new version. Builds and CI never fetch snapshots.

[microsoft-revision]:
  https://github.com/microsoft/rust-guidelines/tree/9585e288d21d2da994a0550c926a09b62d79f8bd
