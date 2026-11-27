/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
import Lean

/-!
# Axiom audit (`lake exe audit_axioms`)

Re-typechecks all `BotgeChemLean.*` declarations in the Lean kernel from scratch and verifies
that only standard axioms (`propext`, `Classical.choice`, `Quot.sound`) are used and every `.tex`
label in `chemistry/docs/botge-chemistry.tex` maps to an existing audited theorem.
-/

open Lean

namespace BotgeChemLean.AuditAxioms

/-- The three standard axioms of Lean and Mathlib. -/
def allowedAxioms : List Name := [``propext, ``Classical.choice, ``Quot.sound]

/-- Map from each `.tex` environment label to the theorems that formalize it. -/
def texLabels : List (String × List Name) := [
  ("prop:chem-budget", [`BotgeChemLean.prop_2_1_chem_budget,
    `BotgeChemLean.prop_2_1_avoidance_nonempty]),
  ("def:substrate-map", [`BotgeChemLean.def_2_2_substrate_bucket]),
  ("def:reaction-set", [`BotgeChemLean.def_3_1_reaction_count]),
  ("thm:stoichiometry", [`BotgeChemLean.thm_3_2_stoichiometry]),
  ("thm:commutativity", [`BotgeChemLean.thm_4_1_canonPair_comm, `BotgeChemLean.thm_4_1_eval_comm]),
  ("thm:projection", [`BotgeChemLean.thm_4_2_projection_bounds,
    `BotgeChemLean.thm_4_2_projection_avoids]),
  ("prop:chem-certificate", [`BotgeChemLean.prop_5_1_table_totals])]

/-- Whether a declaration belongs to a `BotgeChemLean.*` module. -/
def isOwned (env : Environment) (name : Name) : Bool :=
  match env.getModuleIdxFor? name with
  | some idx => (env.header.moduleNames[idx.toNat]?.map (·.getRoot == `BotgeChemLean)).getD false
  | none => false

/-- Every Lean library module under `dir`, excluding `BotgeChemLean.AuditAxioms`. -/
def discoverLibraryModules (dir : System.FilePath) : IO (Array Name) := do
  let mut mods : Array Name := #[]
  for path in ← System.FilePath.walkDir dir do
    if path.extension == some "lean" then
      let mod := (path.withExtension "").components.foldl Name.str .anonymous
      if mod != `BotgeChemLean.AuditAxioms then
        mods := mods.push mod
  return mods

/-- The non-standard axioms a declaration depends on. -/
def badAxioms (env : Environment) (name : Name) : IO (List Name) := do
  let ctx : Core.Context := { fileName := "<audit_axioms>", fileMap := default }
  let state : Core.State := { env }
  let (axioms, _) ← (Lean.collectAxioms name : CoreM (Array Name)).toIO ctx state
  return axioms.toList.filter (· ∉ allowedAxioms)

end BotgeChemLean.AuditAxioms

open BotgeChemLean.AuditAxioms in
/-- Audit every `BotgeChemLean` declaration; exit with status `1` on any failure. -/
def main : IO UInt32 := do
  initSearchPath (← findSysroot)
  let rawEnv ← importModules #[{ module := `BotgeChemLean, importAll := true }] {}
    (trustLevel := 0) (level := .private)
  let env := rawEnv.setExporting false
  let mut failures : Array String := #[]
  let discovered ← discoverLibraryModules "BotgeChemLean"
  if discovered.isEmpty then
    failures := failures.push "no library modules found under BotgeChemLean/"
  match env.getModuleIdx? `BotgeChemLean with
  | some rootIdx =>
    let rootImports := env.header.moduleData[rootIdx.toNat]!.imports
    for mod in discovered do
      unless rootImports.any fun imp ↦ imp.module == mod && imp.isExported && !imp.isMeta do
        failures := failures.push s!"module {mod} is not publicly imported in BotgeChemLean.lean"
  | none =>
    failures := failures.push "missing root module BotgeChemLean"
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
