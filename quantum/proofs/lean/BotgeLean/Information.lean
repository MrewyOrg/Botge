/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import Mathlib.Analysis.SpecialFunctions.Log.NegMulLog
import Mathlib.Algebra.BigOperators.Field
import Mathlib.Algebra.Order.Star.Real
import Mathlib.Analysis.Convex.SpecificFunctions.Basic
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Finite information measures

Entropies and mutual information of finite distributions, measured in nats (divide by `log 2`
for the bits printed in the `.tex`). Mathlib supplies the analytic ingredients: Jensen's
inequality (`ConvexOn.map_sum_le`, `ConcaveOn.le_map_sum`, `StrictConcaveOn.lt_map_sum`), the
convexity of `x log x` (`Real.convexOn_mul_log`), the strict concavity of `log`
(`strictConcaveOn_log_Ioi`), and the binary entropy `Real.binEntropy`. Mathlib's data processing
inequality (`klDiv_map_le`) is stated for measures; the finite form used here follows from the
log-sum inequality.

* `log_sum_le`: the log-sum inequality.
* `mutualInfo_pushPair_le`: data processing inequality for mutual information under maps of
  each coordinate (`eq:mi-lower`).
* `renyi_le_shannon`: collision entropy `S₂ = -log ∑ p²` is at most the Shannon entropy.
* `shannon_lt_log_card`: the Shannon entropy is strictly below `log n` unless `∑ p² = 1 / n`.
-/

open Finset Real

namespace BotgeLean

@[expose] public section

/-- **Log-sum inequality**: `(∑ a) log (∑ a / ∑ b) ≤ ∑ a log (a / b)` for nonnegative `a, b` with
`a` absolutely continuous with respect to `b`. -/
theorem log_sum_le {ι : Type*} (s : Finset ι) (a b : ι → ℝ) (ha : ∀ i ∈ s, 0 ≤ a i)
    (hb : ∀ i ∈ s, 0 ≤ b i) (hab : ∀ i ∈ s, b i = 0 → a i = 0) :
    (∑ i ∈ s, a i) * log ((∑ i ∈ s, a i) / ∑ i ∈ s, b i) ≤ ∑ i ∈ s, a i * log (a i / b i) := by
  set A := ∑ i ∈ s, a i
  set B := ∑ i ∈ s, b i
  rcases (Finset.sum_nonneg hb).eq_or_lt with hB | hB
  · have hb0 : ∀ i ∈ s, b i = 0 := (Finset.sum_eq_zero_iff_of_nonneg hb).mp hB.symm
    have ha0 : ∀ i ∈ s, a i = 0 := fun i hi ↦ hab i hi (hb0 i hi)
    have hA : A = 0 := Finset.sum_eq_zero ha0
    rw [hA, zero_mul]
    exact (Finset.sum_eq_zero fun i hi ↦ by simp [ha0 i hi]).ge
  · have hpt : ∀ i ∈ s, b i / B * (a i / b i) = a i / B := by
      intro i hi
      rcases (hb i hi).eq_or_lt with h0 | hpos
      · simp [← h0, hab i hi h0.symm]
      · field_simp
    have hjensen := convexOn_mul_log.map_sum_le (t := s) (w := fun i ↦ b i / B)
      (p := fun i ↦ a i / b i) (fun i hi ↦ div_nonneg (hb i hi) hB.le)
      (by rw [← Finset.sum_div, div_self hB.ne'])
      (fun i hi ↦ Set.mem_Ici.mpr (div_nonneg (ha i hi) (hb i hi)))
    simp only [smul_eq_mul] at hjensen
    rw [Finset.sum_congr rfl hpt, ← Finset.sum_div] at hjensen
    have hrhs : ∑ i ∈ s, b i / B * (a i / b i * log (a i / b i)) =
        (∑ i ∈ s, a i * log (a i / b i)) / B := by
      rw [Finset.sum_div]
      refine Finset.sum_congr rfl fun i hi ↦ ?_
      rw [← mul_assoc, hpt i hi, div_mul_eq_mul_div]
    rw [hrhs, le_div_iff₀ hB] at hjensen
    have hB0 : B ≠ 0 := hB.ne'
    calc A * log (A / B) = A / B * log (A / B) * B := by field_simp
      _ ≤ _ := hjensen

section MutualInfo

variable {α β : Type*} [Fintype α] [Fintype β]

/-- First marginal of a joint distribution. -/
def margL (P : α × β → ℝ) (a : α) : ℝ := ∑ b, P (a, b)

/-- Second marginal of a joint distribution. -/
def margR (P : α × β → ℝ) (b : β) : ℝ := ∑ a, P (a, b)

/-- Mutual information `I(A; B) = ∑ P log (P / (P_A P_B))` in nats. -/
noncomputable def mutualInfo (P : α × β → ℝ) : ℝ :=
  ∑ x, P x * log (P x / (margL P x.1 * margR P x.2))

/-- The joint law of `(f A, g B)`. -/
def pushPair {α' β' : Type*} [DecidableEq α'] [DecidableEq β'] (f : α → α') (g : β → β')
    (P : α × β → ℝ) (y : α' × β') : ℝ :=
  ∑ x with (f x.1, g x.2) = y, P x

variable {α' β' : Type*} [Fintype α'] [Fintype β'] [DecidableEq α'] [DecidableEq β']

omit [Fintype α'] in
private theorem margL_pushPair (f : α → α') (g : β → β') (P : α × β → ℝ) (a' : α') :
    margL (pushPair f g P) a' = ∑ a with f a = a', margL P a := by
  simp only [margL, pushPair, Finset.sum_filter, Prod.mk.injEq]
  rw [Finset.sum_comm, Fintype.sum_prod_type]
  refine Finset.sum_congr rfl fun a _ ↦ ?_
  split_ifs with h
  · exact Finset.sum_congr rfl fun b _ ↦ by simp [h]
  · simp [h]

omit [Fintype β'] in
private theorem margR_pushPair (f : α → α') (g : β → β') (P : α × β → ℝ) (b' : β') :
    margR (pushPair f g P) b' = ∑ b with g b = b', margR P b := by
  simp only [margR, pushPair, Finset.sum_filter, Prod.mk.injEq]
  rw [Finset.sum_comm, Fintype.sum_prod_type, Finset.sum_comm]
  refine Finset.sum_congr rfl fun b _ ↦ ?_
  split_ifs with h
  · exact Finset.sum_congr rfl fun a _ ↦ by simp [h]
  · simp [h]

/-- **Data processing inequality** (`eq:mi-lower`): coarse-graining each coordinate cannot
increase mutual information, `I(f A; g B) ≤ I(A; B)`. -/
theorem mutualInfo_pushPair_le (f : α → α') (g : β → β') (P : α × β → ℝ) (hP : ∀ x, 0 ≤ P x) :
    mutualInfo (pushPair f g P) ≤ mutualInfo P := by
  have hmL : ∀ a, 0 ≤ margL P a := fun a ↦ Finset.sum_nonneg fun b _ ↦ hP _
  have hmR : ∀ b, 0 ≤ margR P b := fun b ↦ Finset.sum_nonneg fun a _ ↦ hP _
  have hleL : ∀ x : α × β, P x ≤ margL P x.1 := fun x ↦
    Finset.single_le_sum (f := fun b ↦ P (x.1, b)) (fun b _ ↦ hP _) (Finset.mem_univ x.2)
  have hleR : ∀ x : α × β, P x ≤ margR P x.2 := fun x ↦
    Finset.single_le_sum (f := fun a ↦ P (a, x.2)) (fun a _ ↦ hP _) (Finset.mem_univ x.1)
  rw [mutualInfo, mutualInfo,
    ← Finset.sum_fiberwise (s := Finset.univ) (g := fun x : α × β ↦ (f x.1, g x.2))]
  refine Finset.sum_le_sum fun y _ ↦ ?_
  have hfib : ∑ x : α × β with (f x.1, g x.2) = y, margL P x.1 * margR P x.2 =
      margL (pushPair f g P) y.1 * margR (pushPair f g P) y.2 := by
    rw [margL_pushPair, margR_pushPair, Finset.sum_filter, Finset.sum_filter, Finset.sum_filter,
      Finset.sum_mul_sum, ← Fintype.sum_prod_type']
    refine Finset.sum_congr rfl fun x _ ↦ ?_
    by_cases h1 : f x.1 = y.1 <;> by_cases h2 : g x.2 = y.2 <;> simp [h1, h2, Prod.ext_iff]
  have hls := log_sum_le (Finset.univ.filter fun x : α × β ↦ (f x.1, g x.2) = y) P
    (fun x ↦ margL P x.1 * margR P x.2) (fun x _ ↦ hP x)
    (fun x _ ↦ mul_nonneg (hmL _) (hmR _))
    (fun x _ h ↦ by
      rcases mul_eq_zero.mp h with h0 | h0
      · exact le_antisymm (h0 ▸ hleL x) (hP x)
      · exact le_antisymm (h0 ▸ hleR x) (hP x))
  rw [hfib] at hls
  exact hls

/-- Bijective relabelling of each coordinate preserves mutual information. -/
theorem mutualInfo_pushPair_equiv (e₁ : α ≃ α') (e₂ : β ≃ β') (P : α × β → ℝ) :
    mutualInfo (pushPair e₁ e₂ P) = mutualInfo P := by
  have hpush : ∀ x : α × β, pushPair e₁ e₂ P (e₁ x.1, e₂ x.2) = P x := by
    intro x
    rw [pushPair]
    refine Finset.sum_eq_single x (fun y hy hne ↦ ?_) (fun h ↦ ?_)
    · exfalso
      apply hne
      have h' := (Finset.mem_filter.mp hy).2
      exact Prod.ext (e₁.injective (Prod.ext_iff.mp h').1) (e₂.injective (Prod.ext_iff.mp h').2)
    · exact (h (Finset.mem_filter.mpr ⟨Finset.mem_univ _, rfl⟩)).elim
  have hmL : ∀ a : α, margL (pushPair e₁ e₂ P) (e₁ a) = margL P a := by
    intro a
    rw [margL_pushPair]
    refine Finset.sum_eq_single a (fun y hy hne ↦ ?_) (fun h ↦ ?_)
    · exact absurd (e₁.injective (Finset.mem_filter.mp hy).2) hne
    · exact (h (Finset.mem_filter.mpr ⟨Finset.mem_univ _, rfl⟩)).elim
  have hmR : ∀ b : β, margR (pushPair e₁ e₂ P) (e₂ b) = margR P b := by
    intro b
    rw [margR_pushPair]
    refine Finset.sum_eq_single b (fun y hy hne ↦ ?_) (fun h ↦ ?_)
    · exact absurd (e₂.injective (Finset.mem_filter.mp hy).2) hne
    · exact (h (Finset.mem_filter.mpr ⟨Finset.mem_univ _, rfl⟩)).elim
  rw [mutualInfo, mutualInfo, ← (e₁.prodCongr e₂).sum_comp]
  refine Finset.sum_congr rfl fun ⟨a, b⟩ _ ↦ ?_
  rw [Equiv.prodCongr_apply, Prod.map_apply, hpush (a, b), hmL a, hmR b]

end MutualInfo

section Entropy

variable {α : Type*} [Fintype α]

/-- Collision (Rényi-2) entropy `S₂ = -log ∑ p²` is at most the Shannon entropy. -/
theorem renyi_le_shannon (p : α → ℝ) (hp0 : ∀ a, 0 ≤ p a) (hp1 : ∑ a, p a = 1) :
    -log (∑ a, p a ^ 2) ≤ ∑ a, negMulLog (p a) := by
  classical
  set t := Finset.univ.filter fun a ↦ 0 < p a
  have hoff : ∀ a ∉ t, p a = 0 := fun a ha ↦ by
    simp only [t, Finset.mem_filter, Finset.mem_univ, true_and, not_lt] at ha
    exact le_antisymm ha (hp0 a)
  have hrestrict : ∀ g : ℝ → ℝ, g 0 = 0 → ∑ a, g (p a) = ∑ a ∈ t, g (p a) := by
    intro g hg
    exact (Finset.sum_subset (Finset.subset_univ t) fun a _ ha ↦ by rw [hoff a ha, hg]).symm
  have hw : ∑ a ∈ t, p a = 1 := by
    have h := hrestrict (fun x ↦ x) rfl
    rw [← h]
    exact hp1
  have hj := strictConcaveOn_log_Ioi.concaveOn.le_map_sum (t := t) (w := p) (p := p)
    (fun a _ ↦ hp0 a) hw (fun a ha ↦ (Finset.mem_filter.mp ha).2)
  simp only [smul_eq_mul] at hj
  rw [hrestrict (fun x ↦ x ^ 2) (by norm_num), hrestrict negMulLog (by simp)]
  simp only [negMulLog, neg_mul, Finset.sum_neg_distrib, neg_le_neg_iff, sq]
  exact hj

/-- The Shannon entropy of a distribution on `n` points is strictly below `log n` unless its
collision probability is exactly `1 / n` (the uniform case). -/
theorem shannon_lt_log_card (p : α → ℝ) (hp0 : ∀ a, 0 ≤ p a) (hp1 : ∑ a, p a = 1)
    (hnu : ∑ a, p a ^ 2 ≠ 1 / Fintype.card α) :
    ∑ a, negMulLog (p a) < log (Fintype.card α) := by
  classical
  set t := Finset.univ.filter fun a ↦ 0 < p a
  have hoff : ∀ a ∉ t, p a = 0 := fun a ha ↦ by
    simp only [t, Finset.mem_filter, Finset.mem_univ, true_and, not_lt] at ha
    exact le_antisymm ha (hp0 a)
  have hrestrict : ∀ g : ℝ → ℝ, g 0 = 0 → ∑ a, g (p a) = ∑ a ∈ t, g (p a) := by
    intro g hg
    exact (Finset.sum_subset (Finset.subset_univ t) fun a _ ha ↦ by rw [hoff a ha, hg]).symm
  have hw : ∑ a ∈ t, p a = 1 := by
    have h := hrestrict (fun x ↦ x) rfl
    rw [← h]
    exact hp1
  have htpos : 0 < t.card := by
    rw [Finset.card_pos]
    by_contra h
    rw [Finset.not_nonempty_iff_eq_empty.mp h, Finset.sum_empty] at hw
    exact zero_ne_one hw
  have hent : ∑ a, negMulLog (p a) = ∑ a ∈ t, p a * log (p a)⁻¹ := by
    rw [hrestrict negMulLog (by simp)]
    refine Finset.sum_congr rfl fun a _ ↦ ?_
    rw [negMulLog, Real.log_inv]
    ring
  have hcard : ∑ a ∈ t, p a * (p a)⁻¹ = t.card := by
    rw [Finset.card_eq_sum_ones, Nat.cast_sum, Nat.cast_one]
    exact Finset.sum_congr rfl fun a ha ↦ mul_inv_cancel₀ (Finset.mem_filter.mp ha).2.ne'
  have hmem : ∀ a ∈ t, (p a)⁻¹ ∈ Set.Ioi (0 : ℝ) := fun a ha ↦
    Set.mem_Ioi.mpr (inv_pos.mpr (Finset.mem_filter.mp ha).2)
  rw [hent]
  by_cases ht : t = Finset.univ
  · have hconst : ∃ j ∈ t, ∃ k ∈ t, (p j)⁻¹ ≠ (p k)⁻¹ := by
      by_contra hall
      push Not at hall
      obtain ⟨a0⟩ : Nonempty α := ⟨(Finset.card_pos.mp htpos).choose⟩
      have heq : ∀ a, p a = p a0 := fun a ↦
        inv_injective (hall a (by rw [ht]; exact Finset.mem_univ a) a0
          (by rw [ht]; exact Finset.mem_univ a0))
      have hn : (Fintype.card α : ℝ) * p a0 = 1 := by
        rw [← hp1, Finset.sum_congr rfl fun a _ ↦ heq a, Finset.sum_const, Finset.card_univ,
          nsmul_eq_mul]
      apply hnu
      rw [Finset.sum_congr rfl fun a _ ↦ by rw [heq a], Finset.sum_const, Finset.card_univ,
        nsmul_eq_mul]
      have hn0 : (Fintype.card α : ℝ) ≠ 0 := by
        intro h0
        rw [h0, zero_mul] at hn
        exact zero_ne_one hn
      field_simp
      nlinarith [hn]
    have hj := strictConcaveOn_log_Ioi.lt_map_sum (t := t) (w := p) (p := fun a ↦ (p a)⁻¹)
      (fun a ha ↦ (Finset.mem_filter.mp ha).2) hw hmem hconst
    simp only [smul_eq_mul] at hj
    rw [hcard, ht, Finset.card_univ] at hj
    rw [ht]
    exact hj
  · have hj := strictConcaveOn_log_Ioi.concaveOn.le_map_sum (t := t) (w := p)
      (p := fun a ↦ (p a)⁻¹) (fun a _ ↦ hp0 a) hw hmem
    simp only [smul_eq_mul] at hj
    rw [hcard] at hj
    have hlt : (t.card : ℝ) < Fintype.card α := by
      exact_mod_cast (Finset.card_lt_iff_ne_univ t).mpr ht
    exact hj.trans_lt (Real.log_lt_log (by exact_mod_cast htpos) hlt)

end Entropy

end

end BotgeLean
