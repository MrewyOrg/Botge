/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
import Lean

/-!
# Axiom audit (`lake exe audit_axioms`)

Loads the compiled `BotgeLean` library via `importModules` with `trustLevel := 0` and
`OLeanLevel.private` (`setExporting false`), re-typechecking all imported `.olean` and
`.olean.private` files in the Lean kernel from scratch and auditing `private` declarations,
definitions, opaques, and theorems alike. The audit fails unless

* every theorem, definition, and opaque in a `BotgeLean.*` module depends only on `propext`,
  `Classical.choice`, and `Quot.sound` (rejecting `sorryAx`, `Lean.ofReduceBool`,
  `Lean.trustCompiler`, and any custom axiom);
* no `BotgeLean.*` module declares an axiom;
* `BotgeLean.lean` publicly imports every module under `BotgeLean/`;
* every theorem, proposition, lemma, corollary, remark, and definition label of
  `quantum/docs/botge-quantum.tex` maps to at least one existing owned theorem in `texLabels`.

`scripts/quantum/verify_tex_constants.py` parses `texLabels` to check that the `.tex` and this
table stay in sync. Running this executable avoids `#print axioms`, which the hash-command linter
rejects.
-/

open Lean

namespace BotgeLean.AuditAxioms

/-- The three standard axioms of Lean and Mathlib. -/
def allowedAxioms : List Name := [``propext, ``Classical.choice, ``Quot.sound]

/-- Map from each `.tex` environment label to the theorems that formalize it. -/
def texLabels : List (String × List Name) := [
  ("prop:budget", [`BotgeLean.prop_2_1_budget, `BotgeLean.prop_2_1_admissible,
    `BotgeLean.prop_2_1_card_admissible, `BotgeLean.mem_admissibleTriples]),
  ("def:ising-rx", [`BotgeLean.psi_apply, `BotgeLean.prop_3_2_rx_gate]),
  ("prop:compile", [`BotgeLean.prop_3_2_pauli_x, `BotgeLean.pauliZ_eq_diagonal,
    `BotgeLean.prop_3_2_coupling, `BotgeLean.prop_3_2_rzz_commute,
    `BotgeLean.prop_3_2_rzz_factorization, `BotgeLean.circuit_mem_unitary,
    `BotgeLean.sum_born, `BotgeLean.prop_3_2_theta_neg, `BotgeLean.prop_3_2_gate_count]),
  ("thm:entanglement", [`BotgeLean.thm_4_1_entanglement, `BotgeLean.thm_4_1_entanglement_general,
    `BotgeLean.ampMat_swap, `BotgeLean.thm_4_1_toeplitz, `BotgeLean.thm_4_1_toeplitz_base,
    `BotgeLean.thm_4_1_isospectral, `BotgeLean.thm_4_1_schmidt_purity,
    `BotgeLean.thm_4_1_entropy_eq, `BotgeLean.thm_4_1_purity_bounds,
    `BotgeLean.thm_4_1_constants]),
  ("lem:identities", [`BotgeLean.thm_4_3_morrie, `BotgeLean.prod_cos_two_pow,
    `BotgeLean.lem_4_2_heis_rx, `BotgeLean.lem_4_2_heis_rx_quarter,
    `BotgeLean.lem_4_2_trig_plus_exp, `BotgeLean.expect_two_point_expand,
    `BotgeLean.sum_spin_cos, `BotgeLean.sum_spin_exp]),
  ("thm:bitwise-corr", [`BotgeLean.thm_4_3_psi_compl, `BotgeLean.thm_4_3_psi_pauliX,
    `BotgeLean.thm_4_3_jointLaw_compl, `BotgeLean.thm_4_3_margL_compl,
    `BotgeLean.thm_4_3_margR_compl, `BotgeLean.thm_4_3_odd_moment,
    `BotgeLean.thm_4_3_uniform_bit, `BotgeLean.thm_4_3_base_domain_half,
    `BotgeLean.thm_4_3_overlay_domain_half, `BotgeLean.thm_4_3_base_lower_half,
    `BotgeLean.thm_4_3_overlay_lower_half, `BotgeLean.isingTwoPoint, `BotgeLean.corr_spin,
    `BotgeLean.thm_4_3_bitwise_corr, `BotgeLean.thm_4_3_optimal_rx,
    `BotgeLean.thm_4_3_intra_angle_pos, `BotgeLean.thm_4_3_intra_corr_base,
    `BotgeLean.thm_4_3_intra_corr_overlay, `BotgeLean.thm_4_3_msb_corr,
    `BotgeLean.thm_4_3_msb_pos_admissible, `BotgeLean.thm_4_3_msb_corr_pos,
    `BotgeLean.thm_4_3_msb_law, `BotgeLean.thm_4_3_msb_mutualInfo,
    `BotgeLean.thm_4_3_mutualInfo_pos, `BotgeLean.mutualInfo_pushPair_le]),
  ("cor:two-by-two", [`BotgeLean.cor_4_4_two_by_two, `BotgeLean.cor_4_4_psi,
    `BotgeLean.cor_4_4_rhoB, `BotgeLean.cor_4_4_entropy, `BotgeLean.cor_4_4_born,
    `BotgeLean.cor_4_4_corr, `BotgeLean.cor_4_4_rhoB_eigen, `BotgeLean.cor_4_4_entropy_pos,
    `BotgeLean.cor_4_4_sin_strictMono, `BotgeLean.cor_4_4_sin_bounds,
    `BotgeLean.cor_4_4_mutualInfo, `BotgeLean.mutualInfo_pushPair_equiv]),
  ("rem:washout", [`BotgeLean.rem_4_5_washout, `BotgeLean.rem_4_5_mutualInfo_zero]),
  ("thm:rejection", [`BotgeLean.thm_5_1_monotonicity, `BotgeLean.thm_5_1_full_domain,
    `BotgeLean.thm_5_1_acceptance_floor, `BotgeLean.thm_5_1_termination,
    `BotgeLean.thm_5_1_expected_tau, `BotgeLean.thm_5_1_tail, `BotgeLean.thm_5_1_cond_law,
    `BotgeLean.thm_5_1_rejection_admissible]),
  ("prop:certificate", [`BotgeLean.prop_5_2_reduction])]

/-- Whether a declaration belongs to a `BotgeLean.*` module. -/
def isOwned (env : Environment) (name : Name) : Bool :=
  match env.getModuleIdxFor? name with
  | some idx => (env.header.moduleNames[idx.toNat]?.map (·.getRoot == `BotgeLean)).getD false
  | none => false

/-- Every Lean library module under `dir`, excluding `BotgeLean.AuditAxioms`. -/
def discoverLibraryModules (dir : System.FilePath) : IO (Array Name) := do
  let mut mods : Array Name := #[]
  for path in ← System.FilePath.walkDir dir do
    if path.extension == some "lean" then
      let mod := (path.withExtension "").components.foldl Name.str .anonymous
      if mod != `BotgeLean.AuditAxioms then
        mods := mods.push mod
  return mods

/-- The non-standard axioms a declaration depends on. -/
def badAxioms (env : Environment) (name : Name) : IO (List Name) := do
  let ctx : Core.Context := { fileName := "<audit_axioms>", fileMap := default }
  let state : Core.State := { env }
  let (axioms, _) ← (Lean.collectAxioms name : CoreM (Array Name)).toIO ctx state
  return axioms.toList.filter (· ∉ allowedAxioms)

end BotgeLean.AuditAxioms

open BotgeLean.AuditAxioms in
/-- Audit every `BotgeLean` declaration; exit with status `1` on any failure. -/
def main : IO UInt32 := do
  initSearchPath (← findSysroot)
  let rawEnv ← importModules #[{ module := `BotgeLean, importAll := true }] {}
    (trustLevel := 0) (level := .private)
  let env := rawEnv.setExporting false
  let mut failures : Array String := #[]
  let discovered ← discoverLibraryModules "BotgeLean"
  if discovered.isEmpty then
    failures := failures.push "no library modules found under BotgeLean/"
  match env.getModuleIdx? `BotgeLean with
  | some rootIdx =>
    let rootImports := env.header.moduleData[rootIdx.toNat]!.imports
    for mod in discovered do
      unless rootImports.any fun imp ↦ imp.module == mod && imp.isExported && !imp.isMeta do
        failures := failures.push s!"module {mod} is not publicly imported in BotgeLean.lean"
  | none =>
    failures := failures.push "missing root module BotgeLean"
  let mut auditedTheorems := 0
  let mut auditedDefs := 0
  for (name, info) in env.constants.map₁.toList do
    unless isOwned env name do continue
    match info with
    | .axiomInfo _ => failures := failures.push s!"custom axiom declared: {name}"
    | .thmInfo _ =>
      auditedTheorems := auditedTheorems + 1
      let bad ← badAxioms env name
      unless bad.isEmpty do
        failures := failures.push s!"{name} depends on non-standard axioms {bad}"
    | .defnInfo _ | .opaqueInfo _ =>
      auditedDefs := auditedDefs + 1
      let bad ← badAxioms env name
      unless bad.isEmpty do
        failures := failures.push s!"{name} depends on non-standard axioms {bad}"
    | _ => pure ()
  for (label, names) in texLabels do
    if names.isEmpty then
      failures := failures.push s!"tex label {label} has no audited theorem"
    for name in names do
      match env.find? name with
      | some (.thmInfo _) =>
        unless isOwned env name do
          failures := failures.push s!"tex label {label}: external theorem {name}"
      | _ => failures := failures.push s!"tex label {label}: missing theorem {name}"
  if failures.isEmpty then
    IO.println s!"audit_axioms: {auditedTheorems} theorems and {auditedDefs} definitions use only \
      {allowedAxioms}; {texLabels.length} tex labels mapped."
    return 0
  for failure in failures do
    IO.eprintln s!"audit_axioms: {failure}"
  return 1
