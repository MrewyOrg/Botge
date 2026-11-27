/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.MsbAdmissible
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Rejection sampling on admissible domains (Theorem 5.1 and Proposition 5.2)

The acceptance probability `p_A(M_b, M_o, L) = ∑_{(x_b, x_o) ∈ A} P_L(x_b, x_o)` is defined
directly from the Born law of the circuit, with `A = {x_b < M_b} × {x_o < M_o}`. This file proves:

* the monotonicity reduction to `M^min(n) = max(2, 2^{n-1} + 1)` and `p_A(N_b, N_o) = 1`;
* the analytical floor `p_A ≥ (1 + c) / 4 > 1/4` in all three register-width cases, with
  `p_A ≥ 1/2` when `min(n_b, n_o) = 1` and `p_A = 1` when `n_b = n_o = 1` (`c` is the
  most-significant-bit correlation, positive on the admissible domain);
* almost-sure termination, `E[τ] = 1 / p_A < 4`, the 256-trial tail
  `(1 - p_A)^256 < (3/4)^256 < 1.05 × 10⁻³²`, and the exact conditional law on `A`
  (the geometric-series identities are ported from the scratch proof);
* the reduction lemmas behind the 414-configuration certificate (`prop:certificate`).
-/

open Finset

namespace BotgeLean

@[expose] public section

/-- Acceptance probability `p_A(M_b, M_o)` of the rectangle `{x_b < M_b} × {x_o < M_o}`. -/
noncomputable def acceptance (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → Fin nb ⊕ Fin no → ℝ)
    (Mb Mo : ℕ) : ℝ :=
  ∑ x with (finFunctionFinEquiv x.1 : ℕ) < Mb ∧ (finFunctionFinEquiv x.2 : ℕ) < Mo,
    jointLaw nb no φ J x

/-- Minimum admissible domain size `M^min(n) = max(2, 2^{n-1} + 1)`. -/
def mMin (n : ℕ) : ℕ := max 2 (2 ^ (n - 1) + 1)

/-- Joint Born probabilities are nonnegative. -/
theorem jointLaw_nonneg (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ) (x) :
    0 ≤ jointLaw nb no φ J x := born_nonneg _ _ _

/-- Joint Born probabilities sum to `1`. -/
theorem sum_jointLaw (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ) :
    ∑ x, jointLaw nb no φ J x = 1 := by
  rw [← sum_born φ J, ← (Equiv.sumArrowEquivProdArrow (Fin nb) (Fin no) (Fin 2)).symm.sum_comp]
  rfl

/-- Theorem 5.1 (1): monotonicity reduction `p_A(M_b, M_o) ≥ p_A(M^min(n_b), M^min(n_o))`. -/
theorem thm_5_1_monotonicity (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ) (Mb Mo : ℕ)
    (hMb : mMin nb ≤ Mb) (hMo : mMin no ≤ Mo) :
    acceptance nb no φ J (mMin nb) (mMin no) ≤ acceptance nb no φ J Mb Mo :=
  Finset.sum_le_sum_of_subset_of_nonneg
    (Finset.monotone_filter_right _ fun _ _ h ↦ ⟨h.1.trans_le hMb, h.2.trans_le hMo⟩)
    (fun x _ _ ↦ jointLaw_nonneg _ _ _ _ x)

/-- Theorem 5.1 (1): full power-of-two domains accept every outcome, `p_A(N_b, N_o) = 1`. -/
theorem thm_5_1_full_domain (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ) :
    acceptance nb no φ J (2 ^ nb) (2 ^ no) = 1 := by
  rw [acceptance, Finset.filter_true_of_mem fun x _ ↦
    ⟨(finFunctionFinEquiv x.1).isLt, (finFunctionFinEquiv x.2).isLt⟩, sum_jointLaw]

/-- Acceptance probabilities are at most `1`. -/
theorem acceptance_le_one (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ) (Mb Mo : ℕ) :
    acceptance nb no φ J Mb Mo ≤ 1 := by
  rw [← sum_jointLaw nb no φ J]
  exact Finset.sum_le_sum_of_subset_of_nonneg (Finset.filter_subset _ _)
    (fun x _ _ ↦ jointLaw_nonneg _ _ _ _ x)

/-- The most-significant-bit correlation `c_{n_b, n_o, L}` at the optimal readout. -/
noncomputable def msbCorr (n m L : ℕ) : ℝ :=
  corr (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L) (fun y ↦ spin (y (.inl (Fin.last n))))
    (fun y ↦ spin (y (.inr (Fin.last m))))

/-- The most-significant-bit correlation is at most `1`. -/
theorem msbCorr_le_one (n m L : ℕ) : msbCorr n m L ≤ 1 := by
  have h := thm_4_3_msb_law n m (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L) 0 1
  have hnn : 0 ≤ pushPair (msb n) (msb m) (jointLaw (n + 1) (m + 1) (-(Real.pi / 4))
      (coupling (n + 1) (m + 1) L)) (0, 1) :=
    Finset.sum_nonneg fun x _ ↦ jointLaw_nonneg _ _ _ _ x
  rw [h] at hnn
  simp only [spin_zero, spin_one] at hnn
  unfold msbCorr
  linarith

/-- Theorem 5.1 (2): the universal analytical acceptance floor. For every admissible
`(n_b, n_o, L)` and `M^min(n) ≤ M ≤ N`, `p_A ≥ (1 + c) / 4 > 1/4`; moreover `p_A ≥ 1/2` when
`min(n_b, n_o) = 1` and `p_A = 1` when `n_b = n_o = 1`. -/
theorem thm_5_1_acceptance_floor (n m L : ℕ) (h : Admissible (n + 1) (m + 1) L) (Mb Mo : ℕ)
    (hMb : mMin (n + 1) ≤ Mb) (hMo : mMin (m + 1) ≤ Mo) (hMbN : Mb ≤ 2 ^ (n + 1))
    (hMoN : Mo ≤ 2 ^ (m + 1)) :
    let pA := acceptance (n + 1) (m + 1) (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L) Mb Mo
    (1 + msbCorr n m L) / 4 ≤ pA ∧ 1 / 4 < pA ∧ (n = 0 ∨ m = 0 → 1 / 2 ≤ pA) ∧
      (n = 0 → m = 0 → pA = 1) := by
  intro pA
  have hc : 0 < msbCorr n m L := thm_4_3_msb_corr_pos n m L h
  have hc1 := msbCorr_le_one n m L
  have hMb2 : 2 ^ n < Mb := by
    have : 2 ^ (n + 1 - 1) + 1 ≤ mMin (n + 1) := le_max_right _ _
    simp only [Nat.add_sub_cancel] at this
    omega
  have hMo2 : 2 ^ m < Mo := by
    have : 2 ^ (m + 1 - 1) + 1 ≤ mMin (m + 1) := le_max_right _ _
    simp only [Nat.add_sub_cancel] at this
    omega
  have hsub : ∀ P : (Fin (n + 1) → Fin 2) × (Fin (m + 1) → Fin 2) → Prop, ∀ [DecidablePred P],
      (∀ x, P x → (finFunctionFinEquiv x.1 : ℕ) < Mb ∧ (finFunctionFinEquiv x.2 : ℕ) < Mo) →
      ∑ x with P x, jointLaw (n + 1) (m + 1) (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L) x ≤
        pA := fun P _ hP ↦
    Finset.sum_le_sum_of_subset_of_nonneg (fun x hx ↦ by
      simp only [Finset.mem_filter, Finset.mem_univ, true_and] at hx ⊢
      exact hP x hx) (fun x _ _ ↦ jointLaw_nonneg _ _ _ _ x)
  have hhalfB : n = 0 ∨ m = 0 → 1 / 2 ≤ pA := by
    rintro (rfl | rfl)
    · rw [← thm_4_3_overlay_lower_half 1 m _ (coupling 1 (m + 1) L)]
      exact hsub _ fun x hx ↦ ⟨(finFunctionFinEquiv x.1).isLt.trans_le
        (by norm_num at hMb2 ⊢; omega), hx.trans hMo2⟩
    · rw [← thm_4_3_base_lower_half n 1 _ (coupling (n + 1) 1 L)]
      exact hsub _ fun x hx ↦ ⟨hx.trans hMb2, (finFunctionFinEquiv x.2).isLt.trans_le
        (by norm_num at hMo2 ⊢; omega)⟩
  have hfloor : (1 + msbCorr n m L) / 4 ≤ pA := by
    rcases Nat.eq_zero_or_pos n with hn | hn
    · linarith [hhalfB (Or.inl hn)]
    rcases Nat.eq_zero_or_pos m with hm | hm
    · linarith [hhalfB (Or.inr hm)]
    have hlaw := thm_4_3_msb_law n m (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L) 0 0
    simp only [spin_zero, mul_one, one_mul] at hlaw
    rw [msbCorr, ← hlaw, pushPair]
    refine hsub _ fun x hx ↦ ?_
    simp only [Prod.mk.injEq, msb] at hx
    exact ⟨((finFunctionFinEquiv_lt_half_iff x.1).mpr hx.1).trans hMb2,
      ((finFunctionFinEquiv_lt_half_iff x.2).mpr hx.2).trans hMo2⟩
  refine ⟨hfloor, by linarith, hhalfB, fun hn hm ↦ ?_⟩
  subst hn hm
  have hMb' : Mb = 2 ^ 1 := le_antisymm hMbN (by simpa [mMin] using hMb)
  have hMo' : Mo = 2 ^ 1 := le_antisymm hMoN (by simpa [mMin] using hMo)
  simp only [pA]
  rw [hMb', hMo', thm_5_1_full_domain]

/-- Theorem 5.1 (3): almost-sure termination `∑_{k ≥ 1} (1 - p)^{k-1} p = 1`. -/
theorem thm_5_1_termination (pA : ℝ) (hp0 : 0 < pA) (hp1 : pA ≤ 1) :
    ∑' k : ℕ, (1 - pA) ^ k * pA = 1 := by
  rw [tsum_mul_right, tsum_geometric_of_lt_one (by linarith) (by linarith), sub_sub_cancel,
    inv_mul_cancel₀ hp0.ne']

/-- Theorem 5.1 (3): `E[τ] = ∑_{k ≥ 0} (1 - p)^k = 1 / p`, and `E[τ] < 4` above the floor
(ported from the scratch proof). -/
theorem thm_5_1_expected_tau (pA : ℝ) (hp0 : 0 < pA) (hp1 : pA ≤ 1) :
    (∑' k : ℕ, (1 - pA) ^ k) = 1 / pA ∧ (1 / 4 < pA → (∑' k : ℕ, (1 - pA) ^ k) < 4) := by
  have hsum : (∑' k : ℕ, (1 - pA) ^ k) = 1 / pA := by
    rw [tsum_geometric_of_lt_one (by linarith) (by linarith), sub_sub_cancel, one_div]
  refine ⟨hsum, fun h4 ↦ ?_⟩
  rw [hsum, div_lt_iff₀ hp0]
  linarith

/-- Theorem 5.1 (3): the 256-trial exhaustion probability is below `(3/4)^256 < 1.05 × 10⁻³²`. -/
theorem thm_5_1_tail (pA : ℝ) (hp : 1 / 4 < pA) (hp1 : pA ≤ 1) :
    (1 - pA) ^ 256 < (3 / 4 : ℝ) ^ 256 ∧ (3 / 4 : ℝ) ^ 256 < 105 / 10 ^ 34 := by
  refine ⟨pow_lt_pow_left₀ (by linarith) (by linarith) (by norm_num), by norm_num⟩

/-- Theorem 5.1 (3), `eq:cond-law`: the accepted outcome follows the exact conditional Born law
`P(X_τ = x) = P_L(x) / p_A` (ported from the scratch proof). -/
theorem thm_5_1_cond_law (pA Px : ℝ) (hp0 : 0 < pA) (hp1 : pA ≤ 1) :
    (∑' k : ℕ, (1 - pA) ^ k * Px) = Px / pA := by
  rw [tsum_mul_right, tsum_geometric_of_lt_one (by linarith) (by linarith), sub_sub_cancel,
    ← div_eq_inv_mul]

/-- Theorem 5.1 (3) instantiated on Botge's admissible circuit and domain: the stopping-time
series sums to `1`, has mean `1 / p_A < 4`, 256-shot tail `(1 - p_A)^256 < (3/4)^256 < 1.05e-32`,
and accepted law `P_L(x) / p_A`. -/
theorem thm_5_1_rejection_admissible (n m L : ℕ) (h : Admissible (n + 1) (m + 1) L) (Mb Mo : ℕ)
    (hMb : mMin (n + 1) ≤ Mb) (hMo : mMin (m + 1) ≤ Mo) (hMbN : Mb ≤ 2 ^ (n + 1))
    (hMoN : Mo ≤ 2 ^ (m + 1)) (x : (Fin (n + 1) → Fin 2) × (Fin (m + 1) → Fin 2)) :
    let J := coupling (n + 1) (m + 1) L
    let pA := acceptance (n + 1) (m + 1) (-(Real.pi / 4)) J Mb Mo
    let Px := jointLaw (n + 1) (m + 1) (-(Real.pi / 4)) J x
    (∑' k : ℕ, (1 - pA) ^ k * pA = 1) ∧
      (∑' k : ℕ, (1 - pA) ^ k) = 1 / pA ∧
      (∑' k : ℕ, (1 - pA) ^ k) < 4 ∧
      (1 - pA) ^ 256 < (3 / 4 : ℝ) ^ 256 ∧
      (3 / 4 : ℝ) ^ 256 < 105 / 10 ^ 34 ∧
      (∑' k : ℕ, (1 - pA) ^ k * Px) = Px / pA := by
  intro J pA Px
  obtain ⟨-, h4, -⟩ := thm_5_1_acceptance_floor n m L h Mb Mo hMb hMo hMbN hMoN
  have hp0 : 0 < pA := by linarith
  have hp1 : pA ≤ 1 := acceptance_le_one (n + 1) (m + 1) (-(Real.pi / 4)) J Mb Mo
  obtain ⟨hexp, hlt4⟩ := thm_5_1_expected_tau pA hp0 hp1
  obtain ⟨htail, hbound⟩ := thm_5_1_tail pA h4 hp1
  exact ⟨thm_5_1_termination pA hp0 hp1, hexp, hlt4 h4, htail, hbound,
    thm_5_1_cond_law pA Px hp0 hp1⟩

/-- Proposition 5.2: the certificate's reductions. A sweep that certifies `p_A ≥ p_min > 0` for
every configuration bounds `E[τ] ≤ 1 / p_min` and the 256-trial tail by `(1 - p_min)^256`. -/
theorem prop_5_2_reduction (pA pMin : ℝ) (hmin : 0 < pMin) (hp : pMin ≤ pA) (hp1 : pA ≤ 1) :
    1 / pA ≤ 1 / pMin ∧ (1 - pA) ^ 256 ≤ (1 - pMin) ^ 256 :=
  ⟨one_div_le_one_div_of_le hmin hp,
    pow_le_pow_left₀ (by linarith) (by linarith) 256⟩

end

end BotgeLean
