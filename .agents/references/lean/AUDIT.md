# Lean 4 and Mathlib baseline audit

Reviewed 2026-11-26 against the [pinned Lean guides and linter specs](README.md). Scope:
[`quantum/proofs/lean`](../../../quantum/proofs/lean) (`lakefile.toml`, `BotgeLean/*.lean`,
`audit_axioms`), [`check_proofs.py`](../../../scripts/quantum/check_proofs.py),
[`.editorconfig`](../../../.editorconfig) and the Lean settings in
[`.vscode/settings.json`](../../../.vscode/settings.json).

## Review matrix

- **Lake options** ([Mathlib `lakefile.lean`](../cache/lean-mathlib-lakefile.lean),
  [Lake reference](../cache/lean-core-lake-README.md)): `lakefile.toml` mirrors `mathlibLeanOptions`
  (`autoImplicit = false`, `pp.unicode.fun`, `maxSynthPendingDepth = 3`) and adds
  `relaxedAutoImplicit = false` and `warningAsError = true`, so every linter warning fails the
  build. Linter options use the `weak.` prefix, as Mathlib's own `lakefile.lean` does, because the
  linters are defined in Mathlib rather than core.
- **Standard linter set** ([`Mathlib/Init.lean`](../cache/lean-mathlib-Init.lean)):
  `weak.linter.mathlibStandardSet` enables `flexible`, `hashCommand`, `style.header`, `cdot`,
  `docString`, `dollarSyntax`, `emptyLine`, `lambdaSyntax`, `longLine`, `longFile`, `multiGoal`,
  `missingEnd`, `setOption`, `show`, `whitespace` and the unused-instance linters. The lakefile also
  sets `style.header`, `longLine`, `longFile = 1500`, `unusedVariables`, `unusedTactic`,
  `dupNamespace` and `style.nameCheck` explicitly.
- **Header** ([Header linter](../cache/lean-mathlib-linter-Header.lean)): every module starts with
  the copyright block, `module`, imports, then a `/-! … -/` module doc. Mathlib does not import
  `Mathlib.Tactic` or `Lake`.
- **Imports** ([MinImports](../cache/lean-mathlib-linter-MinImports.lean)): each module carries the
  exact set `#min_imports` reported against targeted Mathlib domain and tactic imports instead of
  `import Mathlib`, computed in dependency order (5,654 build jobs instead of 6,630 or 18,251). Some
  reported modules, such as `Mathlib.Tactic.ReduceModChar`, supply the simp sets or simprocs that
  `simp`, `ring_nf` and `norm_num` used.
- **Naming and style** ([naming](../cache/lean-community-naming.md),
  [style](../cache/lean-community-style.md),
  [Style linters](../cache/lean-mathlib-linter-Style.lean)): theorems are `snake_case` and keep the
  `.tex` numbering (`thm_4_3_msb_corr`), definitions are `lowerCamelCase` (`psiTwoByTwoClosed`,
  `msbCorr`), modules are `UpperCamelCase`, and lines are at most 100 columns.
- **Documentation** ([doc style](../cache/lean-community-doc.md),
  [DocString linter](../cache/lean-mathlib-linter-DocString.lean),
  [Lint](../cache/lean-mathlib-linter-Lint.lean)): every definition, structure and public theorem
  has a docstring; `lake lint` runs Batteries' [`runLinter`](../cache/lean-batteries-runLinter.lean)
  (`docBlame` checks definitions, plus `defsWithUnderscore`, `dupNamespace` and simp-normal-form
  checks).
- **Axioms** ([`Lean.collectAxioms`](../cache/lean-core-CollectAxioms.lean),
  [HashCommandLinter](../cache/lean-mathlib-linter-HashCommandLinter.lean)): `lake exe audit_axioms`
  loads `BotgeLean` with `importAll := true`, `trustLevel := 0` and `.private` /
  `setExporting false`, checks every theorem and definition (`.defnInfo`/`.opaqueInfo`) including
  `private` declarations, fails on anything outside `propext`, `Classical.choice` and `Quot.sound`,
  fails on any `axiom` declaration or orphan `.lean` module under `BotgeLean/`, and checks `.tex`
  label theorem ownership (`isOwned`).
- **Formatting** ([style](../cache/lean-community-style.md),
  [TextBased](../cache/lean-mathlib-linter-TextBased.lean)): Lean has no maintained formatter.
  `.editorconfig` `[*.lean]` sets two-space indentation and 100 columns. `check_proofs.py` repeats
  Mathlib's text checks (LF only, no trailing whitespace or tabs, at most 100 columns), because
  `lake exe lint-style` is internal to Mathlib.
- **VS Code** ([`package.json`](../cache/lean-vscode-package.json)): the `lean4.*` keys in
  `.vscode/settings.json` exist in the pinned schema (the schema has no telemetry or update
  setting). `[lean4]` disables format-on-save and format-on-paste, sets a ruler at 100, two-space
  tabs and no word wrap. `**/.lake/**` is excluded from watching and search, and the Lake output and
  manifest are read-only.

## Discrepancies found and resolved

1. **Header license:** the Header linter requires Mathlib's Apache 2.0 line by default. Botge is MIT
   (`LICENSE.txt`), so `weak.linter.style.header.license` is set to the `LICENSE.txt` MIT line in
   `[leanOptions]`, which reaches both builds and the language server (`moreLeanArgs` reaches builds
   only). TOML cannot give `weak.linter.style.header` both a value and a child key, so that key is
   left out; the `mathlibStandardSet` already enables the linter.
2. **Contribution guides moved:** the `templates/contribute/*.html` files of
   `leanprover-community.github.io` are redirect stubs. The pinned sources are the Markdown guides
   in `leanprover-community/mathlib-landing`.
3. **`#print axioms`:** the scratch audit printed axioms with `#print axioms`, which the
   hash-command linter rejects under `warningAsError`. `audit_axioms` replaces it. A probe module
   declaring an axiom made the audit exit with status 1 and name both the axiom and its dependent
   theorem.
4. **Lindemann–Weierstrass:** the scratch proof assumed `axiom lindemann_weierstrass_pi`. Theorem
   4.2 (3) is now proved only on Botge's admissible domain (`n_b ∈ 1..10`, `n_o ∈ 1..7`,
   `n_b + n_o ≤ 16`, `L ∈ 1..6`). There `N_min = 2^m` with `m ∈ 1..7`, and each of the 42 pairs
   `(m, L)` places `u_L 2^m / 4` strictly between consecutive multiples of `π`, using rational
   enclosures and `Real.pi_gt_d4` / `Real.pi_lt_d4`. The worst margin is about `0.114` at `(3, 6)`.
   The `.tex` argues the all-widths statement with Lindemann–Weierstrass, and the unnumbered remark
   after Theorem 4.3 records this admissible-domain argument.
5. **Reuse before proof:** the formalization uses Mathlib's `Fintype.prod_sum`,
   `finFunctionFinEquiv`, `Fin.revPerm`, `Real.goldenRatio`, `Matrix.kronecker` unitarity,
   `Real.binEntropy`, Jensen's inequality, `IsHermitian.spectral_theorem`, `eigenvalues`,
   `roots_charpoly_eq_eigenvalues`, `charpoly_mul_comm_of_le` and `tsum_geometric_of_lt_one`. It
   also ports the scratch proofs (Dirichlet sum, purity bounds, Heisenberg identities, Morrie, the 2
   × 2 state, the most-significant-bit collapse and washout) instead of rewriting them. Mathlib's
   data processing inequality (`klDiv_map_le`) is measure-theoretic, so the finite form is derived
   from the log-sum inequality.
6. **Scope notes:**
   - Theorem 4.1 holds for every ordering of the registers: `thm_4_1_entanglement` covers
     `n_o ≤ n_b`, and `thm_4_1_entanglement_general` proves the `.tex` statement for every ordering
     through `ampMat_swap`, which shows that exchanging the registers transposes the amplitude
     matrix.
   - `eq:intra-corr` is formalized for both registers (`thm_4_3_intra_corr_base` and
     `thm_4_3_intra_corr_overlay`).
   - The Table 1 values and the Proposition 5.2 extremes and minimizers are proved outside Lean by
     interval arithmetic in `quantum/proofs/certificate/tests/certificate_414.rs`, and
     `tests/lean_identities.rs` checks the simulator against the Lean-proved complement invariance,
     uniform bits, `eq:bitwise-corr` and `eq:intra-corr` in all 414 configurations. The other
     decimals printed in the `.tex` are proved to round to their printed digits by mpmath interval
     arithmetic in `verify_tex_constants.py`.
   - Lean proves the printed inequalities: `0.659`, `0.953`, `0.304`, `0.687`, and
     `(3/4)^256 < 1.05 × 10⁻³²`.
7. **Renames:** the scratch definitions `psi2x2_circuit` and `psi2x2_closed` became
   `psiTwoByTwoCircuit` and `psiTwoByTwoClosed`. The scratch template's `Basic.lean` and README were
   dropped. The dedicated scratch circuit `psiTwoByTwoCircuit` (with `rxMatTwo` and `kronTwo`) was
   later retired: `cor_4_4_psi` proves directly that the general circuit `psi` prepares
   `psiTwoByTwoClosed`.
8. **`docPrime`:** Mathlib disables it upstream (mathlib4#20560); Botge does not enable it.

## Statement fidelity

A side-by-side read of every `texLabels` entry against the `.tex` (2026-11-26) confirmed the mapped
statements are faithful and closed the remaining fidelity gaps. Entropy and mutual information use
`Real.log` (nats) rather than base-2 bits, preserving exact inequalities and factor ratios.

- Corollary 4.4: `cor_4_4_psi` ties the closed-form statevector to the general circuit `psi`,
  `cor_4_4_rhoB` and `cor_4_4_entropy` prove `ρ_B = ½ I + ½ cos ϑ_L X` and
  `S(ρ_B) = h((1 + cos ϑ_L) / 2)` for its actual output (`TwoByTwoCircuit.lean`), and
  `cor_4_4_mutualInfo` proves `mutualInfo (jointLaw 1 1 ...)` directly via
  `mutualInfo_pushPair_equiv`.
- Theorem 4.1 (`thm:entanglement`): `thm_4_1_entanglement`, `thm_4_1_toeplitz_base` and
  `thm_4_1_entanglement_general` state the explicit conjugation `ρ_R = W ρ_R^(0) W†`
  (`rhoO = W * rhoO0 * Wᴴ` and `rhoB = W * rhoB0 * Wᴴ`) across both register orderings (`n_o ≤ n_b`
  and `n_b ≤ n_o`).
- Theorem 4.3 (`thm:pauli-corr`): `thm_4_3_psi_pauliX` proves `ψ(θ_L, θ_R)` directly using `pauliX`
  alongside `thm_4_3_margL_compl`, `thm_4_3_margR_compl`, `thm_4_3_base_lower_half`,
  `thm_4_3_overlay_lower_half`, `thm_4_3_intra_angle_pos` and `corr_spin`.
- Lemma 4.2 (`lem:expected-corr`): parts (1), (2) and (4) are formalized by `prod_cos_two_pow`,
  `lem_4_2_heis_rx`, `lem_4_2_heis_rx_quarter` and `lem_4_2_trig_plus_exp`, while part (3) is proved
  via `expect_two_point_expand` and `energy_sub_xor`.
- Theorem 5.1 (`thm:rejection`): `thm_5_1_rejection_admissible` composes `thm_5_1_acceptance_floor`
  and `acceptance_le_one` with `thm_5_1_termination`, `thm_5_1_expected_tau`, `thm_5_1_tail` and
  `thm_5_1_cond_law`.

Two steps stay on paper by design. Theorem 5.1 (3) proves the geometric-series identities, not the
step from i.i.d. trials to `P(τ = k) = (1 - p)^{k-1} p`, `E[τ] = ∑ P(τ > k)` and the law of `X_τ`.
Proposition 3.2 proves the gate-count arithmetic and the `e^{iπ/8} H T† H` form of `R_X`, not the
gate tally itself or the `exp(iπ/8 X)` and `H Rz(-π/4) H` forms.

## Verification

- `python3 .agents/scripts/cache_references.py --check`
- `cd quantum/proofs/lean && lake build && lake lint && lake exe audit_axioms`
- `.venv/bin/python scripts/quantum/check_proofs.py`
