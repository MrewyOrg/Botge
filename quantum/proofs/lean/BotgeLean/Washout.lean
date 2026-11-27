/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.Information
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Classical centering washout (Remark 4.5, `rem:washout`)

Applying a translation-covariant transition law to independent uniform random basis states over
`ℤ_{N_b} × ℤ_{N_o}` and discarding the random centers collapses the output law to the uniform
distribution, so the outputs carry zero mutual information. The averaging argument (a
translation reindexing of the shift sum) is ported from the scratch proof and generalized to any
finite additive group.
-/

open Finset

namespace BotgeLean

@[expose] public section

variable {G : Type*} [AddCommGroup G] [Fintype G]

/-- The output law after averaging the shifted law `f (y - x₀)` over uniform centers `x₀`. -/
noncomputable def washout (f : G → ℝ) (y : G) : ℝ := (1 / Fintype.card G) * ∑ x0, f (y - x0)

/-- Remark 4.5: averaging over uniform shifts yields the uniform law `1 / |G|`. -/
theorem rem_4_5_washout (f : G → ℝ) (hf : ∑ x, f x = 1) (y : G) :
    washout f y = 1 / Fintype.card G := by
  let e : G ≃ G := ⟨fun x ↦ y - x, fun x ↦ y - x, fun x ↦ sub_sub_cancel y x,
    fun x ↦ sub_sub_cancel y x⟩
  have hsum : ∑ x0, f (y - x0) = ∑ x, f x := Fintype.sum_equiv e (fun x0 ↦ f (y - x0)) f
    (fun _ ↦ rfl)
  rw [washout, hsum, hf, mul_one]

/-- Remark 4.5 on `ℤ_{N_b} × ℤ_{N_o}`: the washed-out law has zero mutual information. -/
theorem rem_4_5_mutualInfo_zero (Nb No : ℕ) [NeZero Nb] [NeZero No]
    (f : ZMod Nb × ZMod No → ℝ) (hf : ∑ x, f x = 1) : mutualInfo (washout f) = 0 := by
  have hNb : (Nb : ℝ) ≠ 0 := Nat.cast_ne_zero.mpr (NeZero.ne Nb)
  have hNo : (No : ℝ) ≠ 0 := Nat.cast_ne_zero.mpr (NeZero.ne No)
  have hcard : (Fintype.card (ZMod Nb × ZMod No) : ℝ) = Nb * No := by
    rw [Fintype.card_prod, ZMod.card, ZMod.card, Nat.cast_mul]
  have hw : ∀ x, washout f x = 1 / (Nb * No) := fun x ↦ by rw [rem_4_5_washout f hf, hcard]
  have hL : ∀ a, margL (washout f) a = 1 / Nb := by
    intro a
    simp only [margL, hw, Finset.sum_const, Finset.card_univ, ZMod.card, nsmul_eq_mul]
    field_simp
  have hR : ∀ b, margR (washout f) b = 1 / No := by
    intro b
    simp only [margR, hw, Finset.sum_const, Finset.card_univ, ZMod.card, nsmul_eq_mul]
    field_simp
  refine Finset.sum_eq_zero fun x _ ↦ ?_
  rw [hw, hL, hR]
  have : 1 / ((Nb : ℝ) * No) / (1 / Nb * (1 / No)) = 1 := by field_simp
  rw [this, Real.log_one, mul_zero]

end

end BotgeLean
