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

## Q# and QDK

The [Q# baseline](qsharp/README.md) inventories the official Q# and QDK guides, language reference
subguides, compiler manifest/linter specs, and VS Code settings schema. Its [audit](qsharp/AUDIT.md)
records lint choices, code/config checks, and verification results.

## LaTeX

The [LaTeX baseline](latex/README.md) inventories the official LaTeX2e, `amsmath`, `mathtools`,
`hyperref`, `l2tabuen`, `nag`, `darkmode`, ChkTeX, and LaTeX Workshop references. Its
[audit](latex/AUDIT.md) records `.chktexrc` rules, VS Code configuration choices, and zero-warning
PDF build checks.

## Lean 4 and Mathlib

The [Lean baseline](lean/README.md) inventories the Mathlib contribution guides, the standard linter
set and syntax/environment linter specs, the Lake and `collectAxioms` references, and the VS Code
Lean 4 settings schema. Its [audit](lean/AUDIT.md) records the strict Lake options, the MIT header
license, the axiom audit, the admissible-domain scope of Theorem 4.3 (3), and verification commands.
