/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import Mathlib.Data.Finset.Card
import Mathlib.Tactic.NormNum

/-!
# Chemistry pool budget and substrate map (`prop:chem-budget`, `def:substrate-map`)

Proves the capped pool bounds `2 ≤ M_b ≤ 1024`, `2 ≤ M_o ≤ 128`, the non-emptiness of the
reactant-avoiding complement when `M_b ≥ 3`, and the substrate index range `[0, 32)`.
-/

namespace BotgeChemLean

@[expose] public section

/-- Base-pool cap `1024` (`eq:chem-pool-cap`). -/
def baseCap : ℕ := 1024

/-- Overlay-pool cap `128` (`eq:chem-pool-cap`). -/
def overlayCap : ℕ := 128

/-- Atlas cardinality `K = 32` (`def:substrate-map`). -/
def atlasSize : ℕ := 32

/-- Substrate index obtained by reducing hash `h` modulo `atlasSize`. -/
def substrateBucket (h : ℕ) : ℕ := h % atlasSize

/-- Proposition 2.1 (`prop:chem-budget`): capped pools stay within `[2, 1024]` and `[2, 128]`. -/
theorem prop_2_1_chem_budget (cb co : ℕ) (hcb : 2 ≤ cb) (hco : 2 ≤ co) :
    let Mb := min cb baseCap
    let Mo := min co overlayCap
    2 ≤ Mb ∧ Mb ≤ 1024 ∧ 2 ≤ Mo ∧ Mo ≤ 128 := by
  dsimp only [baseCap, overlayCap]
  omega

/-- Proposition 2.1 (`prop:chem-budget`): whenever `M_b ≥ 3` and at most two base indices are
excluded, at least one valid base index remains outside the excluded set. -/
theorem prop_2_1_avoidance_nonempty (mb e1 e2 : ℕ) (hmb : 3 ≤ mb) :
    ∃ x < mb, x ≠ e1 ∧ x ≠ e2 := by
  by_cases h0 : 0 ≠ e1 ∧ 0 ≠ e2
  · exact ⟨0, by omega, h0.1, h0.2⟩
  · by_cases h1 : 1 ≠ e1 ∧ 1 ≠ e2
    · exact ⟨1, by omega, h1.1, h1.2⟩
    · exact ⟨2, by omega, by omega, by omega⟩

/-- Definition 2.2 (`def:substrate-map`): every hash maps into `[0, 32)`. -/
theorem def_2_2_substrate_bucket (h : ℕ) : substrateBucket h < 32 := by
  dsimp only [substrateBucket, atlasSize]
  exact Nat.mod_lt h (by decide)

end

end BotgeChemLean
