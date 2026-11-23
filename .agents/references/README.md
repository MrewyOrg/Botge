# Implementation references: compact index

These indexes record where Botge applies, adapts or skips the upstream guides its linters encode.
Agents need them only when a change touches one of the listed exceptions; the guides themselves are
cached for reference and do not need reading during routine work. Sources, retrieval dates, hashes
and licenses are recorded in the [manifest](sources.json).

## Rust

The [Rust baseline](rust/README.md) inventories the five pinned Rust references and their licenses.
Its [audit](rust/AUDIT.md) records the subguide review, fixes, and verification. The
[crate guidance](../../crates/AGENTS.md) owns Botge's checklist and deviations.

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

## Go

The [Go baseline](go/README.md) inventories the official Go, Google and Uber references for the
Activity origin, including their subguides. Its [audit](go/AUDIT.md) records checks, review
questions, and local choices. Snapshots and licenses use the same ignored cache and pinned manifest.
