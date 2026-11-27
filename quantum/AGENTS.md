# Quantum guidance

These rules add to the [root guidance](../AGENTS.md); the [quantum guide](README.md) owns setup and
`check_proofs.py`, and the [Lean audit](../.agents/references/lean/AUDIT.md) records scope gaps.

- `quantum/docs/botge-quantum.tex` is the specification; change proofs and code to match it.
- No `sorry` or custom axioms: `lake exe audit_axioms` reports only `propext`, `Classical.choice`
  and `Quot.sound`. Reuse Mathlib lemmas instead of re-proving them.
- Theorem 4.3 (3) holds only on Botge's admissible domain; keep new results inside the recorded
  scope.
- Lean: set the license header through `[leanOptions]` in `lakefile.toml` (not `moreLeanArgs`, which
  the editor ignores), write lint options with an unquoted `weak.` prefix, and regenerate imports
  with `#min_imports` after edits.
- The sidecar stays CPU-only and free to run (see the
  [cost policy](../docs/PRODUCTION.md#cost-policy)).
