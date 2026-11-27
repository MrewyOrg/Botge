# Q# baseline audit

Reviewed 2026-11-24 and updated 2026-11-26 for Phase 1 v2 against the
[pinned guides and compiler specs](README.md). Scope: `quantum/qsharp.json`,
`quantum/src/BotgeQuantum.qs`, `quantum/src/BotgeQuantumTests.qs`, and the Q# and LaTeX settings in
`.vscode/settings.json` and `.vscode/extensions.json`.

## Review matrix

- **Project layout** ([Q# projects](../cache/qsharp-projects.md)): `quantum/qsharp.json` alongside
  `quantum/src/*.qs`, with the tests in the same project as in Microsoft's QDK libraries.
- **Implicit namespace** ([Namespaces](../cache/qsharp-lang-program-namespaces.md), AST lints):
  omitted `namespace` block so `BotgeQuantum.qs` supplies the module namespace.
- **Target profile** ([Target profiles](../cache/qsharp-target-profiles.md)): production
  `"targetProfile": "base"`, matching Python `TargetProfile.Base` in the sidecar and checked by
  compiling `EntangleStack` to Base QIR. Every `@Test()` also compiles and runs under Base; state
  checks run from Python on `dump_machine()` in `quantum/tests/test_circuit.py`.
- **Lints** ([AST lints](../cache/qsharp-spec-lints-ast.rs), HIR lints, groups): `deprecations`
  group plus all 8 schema-valid individual lints set to `"error"`, enforced outside VS Code by
  `scripts/quantum/lint-qsharp.ts` through the `qsharp-lang` language service; `deprecatedBorrow` is
  enforced statically by `scripts/quantum/check_qsharp.py`.
- **Imports and exports** ([Q# projects](../cache/qsharp-projects.md)): explicit `import Std.*` and
  `export ApplyIsingRxCircuit, EntangleStack`.
- **Comments** ([Comments](../cache/qsharp-lang-program-comments.md)): `/// # Summary`, `# Input`,
  `# Output`, and `# Remarks` doc sections.
- **Quantum memory** ([Memory management](../cache/qsharp-lang-stmt-memory.md)): `use` allocation
  with `MResetEachZ`, which Base QIR lowers to measure-and-reset without branching.
- **Functors** ([Specializations](../cache/qsharp-lang-program-specializations.md)): pure
  `is Adj + Ctl` on `ApplyPositionCoupling` and `ApplyIsingRxCircuit`.
- **Testing and `Fact`** ([Testing code](../cache/qsharp-test-quantum-code.md), `test_utils.py`):
  `@Test()` operations, `qdk.test_utils.run_tests()`, and `Fact` guards.
- **VS Code and telemetry** ([Extension schema](../cache/qsharp-spec-vscode-package.json)): verified
  `Q#.*` keys and `"telemetry.telemetryLevel": "off"`.

## Discrepancies found and resolved

1. **`avoidNamespaceBlock` and source file naming:** The baseline draft used `EmoteCircuit.qs` with
   an explicit `namespace BotgeQuantum { ... }` block, which triggers `avoidNamespaceBlock`.
   Renaming the source file to `quantum/src/BotgeQuantum.qs` and removing the `namespace` block
   satisfies all 15 schema-valid `qsc_linter` rules at `"error"` while preserving the Python import
   `from qdk.code.BotgeQuantum import EntangleStack`.
2. **Full `qsc_linter` coverage beyond baseline 3 rules:** Expanded `quantum/qsharp.json` from the
   3-rule baseline (`needlessParens`, `divisionByZero`, `redundantSemicolons`) to include the
   `deprecations` group plus `discourageChainAssignment`, `doubleEquality`, `needlessOperation`,
   `ambiguousUnaryOperatorAfterIf`, and `avoidNamespaceBlock` at `"error"`. Because upstream
   `qsharp.schema.json` omits `deprecatedBorrow` (PR #2929), QDK keeps its `warn` default and
   `scripts/quantum/check_qsharp.py` enforces it statically as an error.
3. **VS Code Q# telemetry & configuration keys:** Verified against `source/vscode/package.json` and
   `source/vscode/src/telemetry.ts` that the extension has no `Q#.telemetry` key and instead reads
   VS Code's `"telemetry.telemetryLevel": "off"`; disabled `Q#.azure.uploadSupplementalData` and
   update notifications explicitly.
4. **Auto-generated `Adj + Ctl` constraint:** Verified against the specializations guide that
   `mutable` locals break auto-generated `Adjoint`, so `ApplyPositionCoupling` and
   `ApplyIsingRxCircuit` stay pure immutable loops and `check_qsharp.py` instruments coverage using
   only pure `Message` functions.
5. **Base profile rejects test assertions:** QDK 1.34 reports `UseOfDynamicBool` for
   `Fact(CheckAllZero(...))` in any callable of a Base project, because `CheckAllZero` reads qubit
   state, and the same holds for any assertion on a measurement. Rather than mark those tests
   `@Config(Unrestricted)` (Microsoft's `library/chemistry` pattern, which hides them from Base
   builds and VS Code's Testing view), the unitarity, closed-form, complement and entanglement
   checks moved to `quantum/tests/test_circuit.py`, which compares `dump_machine()` state vectors
   under Base as Microsoft's `samples/testing/states` does. The `@Test()` operations that remain
   check static `Length` values and run under Base. Loops iterate `IndexRange` instead of
   `0..n - 1`, so coverage has no unreachable empty-range branch.
6. **`qsharp.json` lints never ran outside VS Code:** the Python `qdk` package compiles and runs Q#
   but does not lint, so a `needlessParens` error in `1 <<< (j + l)` passed `check_qsharp.py` while
   VS Code flagged it. `scripts/quantum/lint-qsharp.ts` now runs the same language service from the
   `qsharp-lang` npm package, pinned to the `qdk` version (`check_qsharp.py` fails on a mismatch),
   under Base and under Unrestricted, and fails on any error or warning.

## Verification

Run `.venv/bin/python scripts/quantum/check_qsharp.py` to verify `quantum/qsharp.json`, compile with
zero Q# warnings, check the Base QIR gate tally, run static lint checks and the language-service
linter across `quantum/src/*.qs`, execute all `@Test()` callables via `qdk.test_utils.run_tests()`,
test every `Fact` precondition guard, and enforce >= 90% Q# statement and branch coverage
(`coverage/qsharp/coverage.json`).
