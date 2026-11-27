/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import Mathlib.Data.Nat.Basic

/-!
# Bounded projection and reactant avoidance (`thm:projection`)

Proves that modular hash projection with up to two unit shifts modulo `M_b` always stays within
`[0, M_b)` and strictly avoids both excluded reactant indices whenever `M_b ≥ 3`.
-/

namespace BotgeChemLean

@[expose] public section

/-- Single modular avoidance step for up to two excluded indices. -/
def avoidStep (x mb cnt e1 e2 : ℕ) : ℕ :=
  if (cnt ≥ 1 ∧ x = e1) ∨ (cnt ≥ 2 ∧ x = e2) then (x + 1) % mb else x

/-- Bounded base projection (`thm:projection`): at most two modular increments when `mb ≥ 3`. -/
def projectBase (hb mb cnt e1 e2 : ℕ) : ℕ :=
  if mb < 3 then hb % mb else avoidStep (avoidStep (hb % mb) mb cnt e1 e2) mb cnt e1 e2

/-- Bounded overlay projection (`thm:projection`). -/
def projectOverlay (ho mo : ℕ) : ℕ := ho % mo

private theorem avoidStep_lt (x mb cnt e1 e2 : ℕ) (hx : x < mb) (hmb : 0 < mb) :
    avoidStep x mb cnt e1 e2 < mb := by
  dsimp only [avoidStep]
  split_ifs
  · exact Nat.mod_lt _ hmb
  · exact hx

/-- Theorem 4.2 (`thm:projection`): `projectBase` and `projectOverlay` stay in `[0, M_b)` and
`[0, M_o)` for all `M_b ≥ 2`, `M_o ≥ 2`. -/
theorem thm_4_2_projection_bounds (hb ho mb mo cnt e1 e2 : ℕ) (hmb : 2 ≤ mb) (hmo : 2 ≤ mo) :
    projectBase hb mb cnt e1 e2 < mb ∧ projectOverlay ho mo < mo := by
  have hmb0 : 0 < mb := by omega
  have hmo0 : 0 < mo := by omega
  refine ⟨?_, Nat.mod_lt ho hmo0⟩
  dsimp only [projectBase]
  split_ifs
  · exact Nat.mod_lt hb hmb0
  · exact avoidStep_lt _ mb cnt e1 e2 (avoidStep_lt _ mb cnt e1 e2 (Nat.mod_lt hb hmb0) hmb0) hmb0

private theorem succ_mod_ne (x mb : ℕ) (hx : x < mb) (hmb : 2 ≤ mb) :
    (x + 1) % mb ≠ x := by
  intro h
  by_cases hlast : x + 1 < mb
  · rw [Nat.mod_eq_of_lt hlast] at h
    omega
  · have hwrap : x + 1 = mb := by omega
    rw [hwrap, Nat.mod_self] at h
    omega

private theorem succ_two_mod_ne (x mb : ℕ) (hx : x < mb) (hmb : 3 ≤ mb) :
    ((x + 1) % mb + 1) % mb ≠ x := by
  intro h
  by_cases h1 : x + 1 < mb
  · rw [Nat.mod_eq_of_lt h1] at h
    by_cases h2 : x + 2 < mb
    · rw [Nat.mod_eq_of_lt h2] at h
      omega
    · have hwrap : x + 2 = mb := by omega
      rw [hwrap, Nat.mod_self] at h
      omega
  · have hwrap : x + 1 = mb := by omega
    rw [hwrap, Nat.mod_self, Nat.zero_add, Nat.mod_eq_of_lt (by omega)] at h
    omega

private theorem avoidStep_eq_self {x mb cnt e1 e2 : ℕ}
    (h : ¬((cnt ≥ 1 ∧ x = e1) ∨ (cnt ≥ 2 ∧ x = e2))) :
    avoidStep x mb cnt e1 e2 = x := by
  dsimp only [avoidStep]
  simp [h]

private theorem avoidStep_eq_succ {x mb cnt e1 e2 : ℕ}
    (h : (cnt ≥ 1 ∧ x = e1) ∨ (cnt ≥ 2 ∧ x = e2)) :
    avoidStep x mb cnt e1 e2 = (x + 1) % mb := by
  dsimp only [avoidStep]
  simp [h]

/-- Theorem 4.2 (`thm:projection`): whenever `M_b ≥ 3`, `projectBase` avoids every active excluded
index. -/
theorem thm_4_2_projection_avoids (hb mb cnt e1 e2 : ℕ) (hmb : 3 ≤ mb) :
    (cnt ≥ 1 → projectBase hb mb cnt e1 e2 ≠ e1) ∧
      (cnt ≥ 2 → projectBase hb mb cnt e1 e2 ≠ e2) := by
  have hmb2 : 2 ≤ mb := by omega
  have hs0 : hb % mb < mb := Nat.mod_lt hb (by omega)
  dsimp only [projectBase]
  split_ifs with hlt
  · omega
  · by_cases hA : (cnt ≥ 1 ∧ hb % mb = e1) ∨ (cnt ≥ 2 ∧ hb % mb = e2)
    · rw [avoidStep_eq_succ hA]
      have hs1lt : (hb % mb + 1) % mb < mb := Nat.mod_lt _ (by omega)
      have hs1_ne : (hb % mb + 1) % mb ≠ hb % mb := succ_mod_ne (hb % mb) mb hs0 hmb2
      by_cases hB : (cnt ≥ 1 ∧ (hb % mb + 1) % mb = e1) ∨ (cnt ≥ 2 ∧ (hb % mb + 1) % mb = e2)
      · rw [avoidStep_eq_succ hB]
        have hs2_ne1 : ((hb % mb + 1) % mb + 1) % mb ≠ (hb % mb + 1) % mb :=
          succ_mod_ne _ mb hs1lt hmb2
        have hs2_ne0 : ((hb % mb + 1) % mb + 1) % mb ≠ hb % mb :=
          succ_two_mod_ne (hb % mb) mb hs0 hmb
        rcases hA with ⟨_, ha1⟩ | ⟨_, ha2⟩ <;> rcases hB with ⟨_, hb1⟩ | ⟨_, hb2⟩
        · exact False.elim (hs1_ne (hb1.trans (Eq.symm ha1)))
        · refine ⟨fun _ heq ↦ hs2_ne0 (heq.trans (Eq.symm ha1)),
            fun _ heq ↦ hs2_ne1 (heq.trans (Eq.symm hb2))⟩
        · refine ⟨fun _ heq ↦ hs2_ne1 (heq.trans (Eq.symm hb1)),
            fun _ heq ↦ hs2_ne0 (heq.trans (Eq.symm ha2))⟩
        · exact False.elim (hs1_ne (hb2.trans (Eq.symm ha2)))
      · rw [avoidStep_eq_self hB]
        exact ⟨fun h1 heq ↦ hB (Or.inl ⟨h1, heq⟩), fun h2 heq ↦ hB (Or.inr ⟨h2, heq⟩)⟩
    · rw [avoidStep_eq_self hA, avoidStep_eq_self hA]
      exact ⟨fun h1 heq ↦ hA (Or.inl ⟨h1, heq⟩), fun h2 heq ↦ hA (Or.inr ⟨h2, heq⟩)⟩

end

end BotgeChemLean
