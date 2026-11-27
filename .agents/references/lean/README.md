# Lean 4 and Mathlib references

Reviewed 2026-11-25 for [Botge's Lean formalization](../../../quantum/proofs/lean) of the
[quantum specification](../../../quantum/docs/botge-quantum.tex), its strict Lake configuration,
`audit_axioms`, and the VS Code Lean 4 settings. The [audit](AUDIT.md) maps each guide and linter
spec to local options, code and verification results. The [manifest](../sources.json) pins every
source URL and its SHA-256. Run `python3 .agents/scripts/cache_references.py` to populate the
ignored cache, or add `--check` to verify the cached bytes offline.

## Source inventory

- [leanprover-community/mathlib-landing][landing-repo] (`03622231b1fc`): the Mathlib contribution
  guides that `mathlib.org/contribute` serves. The `templates/contribute` pages of
  `leanprover-community.github.io` are now redirect stubs to these sources.
- [leanprover-community/mathlib4][mathlib-repo] (`fc4f59e577fe`, tag `v4.36.0`): the standard linter
  set, the Lake options Mathlib uses for itself, and the syntax and environment linter specs.
- [leanprover-community/batteries][batteries-repo] (`b4b25a3886a1`, the revision in
  `lake-manifest.json`): the `runLinter` driver behind `lake lint`.
- [leanprover/lean4][lean4-repo] (`611c117bfaf7`, tag `v4.36.0`): the Lake reference, core linters
  and `Lean.collectAxioms`.
- [leanprover/vscode-lean4][vscode-repo] (`b164f8c7186d`, tag `v0.0.242`): the extension's settings
  schema.

### Style, naming and documentation

- [Library style guidelines](../cache/lean-community-style.md): headers, imports, indentation,
  100-column lines, tactic layout and `by` placement.
- [Naming conventions](../cache/lean-community-naming.md): `snake_case` theorems, `lowerCamelCase`
  definitions, `UpperCamelCase` types and modules.
- [Documentation style](../cache/lean-community-doc.md): module docs, docstrings and references.
- [How to contribute](../cache/lean-community-index.md): scope, review values and AI use.

### Mathlib linters and Lake options

- **Standard set:** [`Mathlib/Init.lean`](../cache/lean-mathlib-Init.lean) (the
  `linter.mathlibStandardSet` members and the `docPrime` exclusion) and
  [`lakefile.lean`](../cache/lean-mathlib-lakefile.lean) (`mathlibLeanOptions`, `longFile = 1500`).
- **Syntax linters:** [Style](../cache/lean-mathlib-linter-Style.lean) (`setOption`, `missingEnd`,
  `longLine`, `longFile`, `nameCheck`, `cdot`, `dollarSyntax`, `lambdaSyntax`),
  [Whitespace](../cache/lean-mathlib-linter-Whitespace.lean),
  [EmptyLine](../cache/lean-mathlib-linter-EmptyLine.lean),
  [Header](../cache/lean-mathlib-linter-Header.lean),
  [DocString](../cache/lean-mathlib-linter-DocString.lean),
  [DocPrime](../cache/lean-mathlib-linter-DocPrime.lean),
  [UnusedTactic](../cache/lean-mathlib-linter-UnusedTactic.lean),
  [FlexibleLinter](../cache/lean-mathlib-linter-FlexibleLinter.lean),
  [Multigoal](../cache/lean-mathlib-linter-Multigoal.lean),
  [HashCommandLinter](../cache/lean-mathlib-linter-HashCommandLinter.lean) and
  [MinImports](../cache/lean-mathlib-linter-MinImports.lean).
- **Environment and text linters:** [Lint](../cache/lean-mathlib-linter-Lint.lean) (`dupNamespace`,
  `defsWithUnderscore`), [TextBased](../cache/lean-mathlib-linter-TextBased.lean) and
  [`runLinter`](../cache/lean-batteries-runLinter.lean).

### Lean core, Lake and VS Code

- [Lake reference](../cache/lean-core-lake-README.md): `lakefile.toml`, `leanOptions`,
  `moreLeanArgs`, `lean_exe` and `lintDriver`.
- [Core linter options](../cache/lean-core-linter-Basic.lean) and
  [unused variables](../cache/lean-core-linter-UnusedVariables.lean).
- [`Lean.collectAxioms`](../cache/lean-core-CollectAxioms.lean): the API behind `audit_axioms`.
- [`vscode-lean4/package.json`](../cache/lean-vscode-package.json): the `lean4.*` settings schema.

## Licenses

The Mathlib, Batteries, Lean 4 and VS Code extension snapshots are Apache-2.0
([Mathlib](../cache/LEAN-MATHLIB-LICENSE.txt), [Batteries](../cache/LEAN-BATTERIES-LICENSE.txt),
[Lean 4](../cache/LEAN-CORE-LICENSE.txt), [VS Code extension](../cache/LEAN-VSCODE-LICENSE.txt)).
The contribution guides are MIT ([mathlib-landing](../cache/LEAN-COMMUNITY-LICENSE.txt)). Snapshots
preserve upstream bytes verbatim.

[landing-repo]:
  https://github.com/leanprover-community/mathlib-landing/tree/03622231b1fc978e731997be71a56cac0ae2598a
[mathlib-repo]:
  https://github.com/leanprover-community/mathlib4/tree/fc4f59e577feb1a4956671bc04ac18aaaf8cd842
[batteries-repo]:
  https://github.com/leanprover-community/batteries/tree/b4b25a3886a16daacaf6615c2eea7170a6e8f458
[lean4-repo]: https://github.com/leanprover/lean4/tree/611c117bfaf7b7ae1cfcf246ce6fba31e8f509e9
[vscode-repo]:
  https://github.com/leanprover/vscode-lean4/tree/b164f8c7186de42ae5215406c63fdbe48310f91c
