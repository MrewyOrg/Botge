/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.Rejection
import Mathlib.Algebra.Order.Ring.Star
import Mathlib.Algebra.Order.Star.Real
import Mathlib.Analysis.Real.Pi.Bounds
import Mathlib.Tactic.Monotonicity.Lemmas
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Exact `2 × 2` closed form (Corollary 4.4, `cor:two-by-two`)

For `n_b = n_o = 1`, set `ϑ_L = u_L / 2`. The closed-form state
`e^{iπ/4}(cos(ϑ/2)|++⟩ + sin(ϑ/2)|--⟩)` has Born probabilities `(1 ± sin ϑ) / 4`
(`cor_4_4_two_by_two`), and the general Born law at `n_b = n_o = 1` is exactly
`(1 ± sin ϑ_L) / 4` (`cor_4_4_born`). The reduced state `ρ_B^(0) = ½ I + ½ cos ϑ X` has
eigenvalues `(1 ± cos ϑ) / 2`, so `S(ρ_B) = h((1 + cos ϑ) / 2) > 0`; `Corr(Z_b, Z_o) = sin ϑ_L` is
strictly increasing in `L` with `0.304 < sin ϑ_1` and `sin ϑ_6 < 0.687`; and
`I(B; O) = log 2 - h((1 + sin ϑ_L) / 2) > 0` nats. The approximate decimals `S ≈ 0.3656`,
`I ≈ 0.1968` and `I ≈ 0.3738` bits are proved by interval arithmetic in
`scripts/quantum/verify_tex_constants.py`. `TwoByTwoCircuit` proves that the general circuit `psi`
prepares the closed form and computes `S(ρ_B)` for its output.
-/

open Complex Finset

namespace BotgeLean

@[expose] public section

/-- 2-by-2 closed-form state `e^{i Real.pi / 4}(cos(ϑ / 2)|++⟩ + sin(ϑ / 2)|--⟩)`. -/
noncomputable def psiTwoByTwoClosed (ϑ : ℝ) : Fin 4 → ℂ :=
  fun i =>
    let sg : ℂ := match i with | 0 => 1 | 1 => -1 | 2 => -1 | 3 => 1
    Complex.exp (Complex.I * ((Real.pi / 4 : ℝ) : ℂ)) *
      ((Complex.cos (ϑ / 2 : ℝ) / 2) + sg * (Complex.sin (ϑ / 2 : ℝ) / 2))

/-- The global phase of the `2 × 2` state: `e^{iπ/4} = (√2/2)(1 + i)`. -/
theorem exp_I_pi_div_four :
    Complex.exp (Complex.I * ((Real.pi / 4 : ℝ) : ℂ)) =
      ((Real.sqrt 2 / 2 : ℝ) : ℂ) + Complex.I * ((Real.sqrt 2 / 2 : ℝ) : ℂ) := by
  rw [mul_comm Complex.I _, Complex.exp_mul_I, ← Complex.ofReal_cos, ← Complex.ofReal_sin,
    Real.cos_pi_div_four, Real.sin_pi_div_four]
  ring

/-- Corollary 4.4: the Born probabilities `(1 ± sin ϑ) / 4`, uniform marginals and correlation
`sin ϑ` of the closed-form `2 × 2` state; `cor_4_4_psi` shows the circuit prepares it. -/
theorem cor_4_4_two_by_two (ϑ : ℝ) :
    Complex.normSq (psiTwoByTwoClosed ϑ 0) = (1 + Real.sin ϑ) / 4 ∧
      Complex.normSq (psiTwoByTwoClosed ϑ 1) = (1 - Real.sin ϑ) / 4 ∧
      Complex.normSq (psiTwoByTwoClosed ϑ 2) = (1 - Real.sin ϑ) / 4 ∧
      Complex.normSq (psiTwoByTwoClosed ϑ 3) = (1 + Real.sin ϑ) / 4 ∧
      Complex.normSq (psiTwoByTwoClosed ϑ 0) + Complex.normSq (psiTwoByTwoClosed ϑ 1) = 1 / 2 ∧
      Complex.normSq (psiTwoByTwoClosed ϑ 0) + Complex.normSq (psiTwoByTwoClosed ϑ 2) = 1 / 2 ∧
      Complex.normSq (psiTwoByTwoClosed ϑ 0) - Complex.normSq (psiTwoByTwoClosed ϑ 1) -
        Complex.normSq (psiTwoByTwoClosed ϑ 2) + Complex.normSq (psiTwoByTwoClosed ϑ 3) =
          Real.sin ϑ := by
  have hexp := exp_I_pi_div_four
  have hn_phase : Complex.normSq (Complex.exp (Complex.I * ((Real.pi / 4 : ℝ) : ℂ))) = 1 := by
    rw [hexp, Complex.normSq_apply]
    have hs2 : Real.sqrt 2 ^ 2 = 2 := Real.sq_sqrt (by norm_num)
    simp
    linarith
  have hcos_sq_sin_sq : Real.cos (ϑ / 2) ^ 2 + Real.sin (ϑ / 2) ^ 2 = 1 :=
    Real.cos_sq_add_sin_sq (ϑ / 2)
  have hsin_double : Real.sin ϑ = 2 * Real.sin (ϑ / 2) * Real.cos (ϑ / 2) := by
    have : ϑ = 2 * (ϑ / 2) := by ring
    conv_lhs => rw [this, Real.sin_two_mul]
  have hp0 : Complex.normSq (psiTwoByTwoClosed ϑ 0) = (1 + Real.sin ϑ) / 4 := by
    dsimp only [psiTwoByTwoClosed]
    change Complex.normSq (Complex.exp (Complex.I * ((Real.pi / 4 : ℝ) : ℂ)) *
        ((Complex.cos (ϑ / 2 : ℝ) / 2) + 1 * (Complex.sin (ϑ / 2 : ℝ) / 2))) =
      (1 + Real.sin ϑ) / 4
    rw [one_mul, Complex.normSq_mul, hn_phase, one_mul]
    rw [← Complex.ofReal_cos, ← Complex.ofReal_sin]
    norm_cast
    rw [Complex.normSq_ofReal]
    nlinarith
  have hp1 : Complex.normSq (psiTwoByTwoClosed ϑ 1) = (1 - Real.sin ϑ) / 4 := by
    dsimp only [psiTwoByTwoClosed]
    change Complex.normSq (Complex.exp (Complex.I * ((Real.pi / 4 : ℝ) : ℂ)) *
        ((Complex.cos (ϑ / 2 : ℝ) / 2) + -1 * (Complex.sin (ϑ / 2 : ℝ) / 2))) =
      (1 - Real.sin ϑ) / 4
    rw [neg_one_mul, Complex.normSq_mul, hn_phase, one_mul]
    rw [← Complex.ofReal_cos, ← Complex.ofReal_sin]
    norm_cast
    rw [Complex.normSq_ofReal]
    nlinarith
  have hp2 : Complex.normSq (psiTwoByTwoClosed ϑ 2) = (1 - Real.sin ϑ) / 4 := by
    dsimp only [psiTwoByTwoClosed]
    change Complex.normSq (Complex.exp (Complex.I * ((Real.pi / 4 : ℝ) : ℂ)) *
        ((Complex.cos (ϑ / 2 : ℝ) / 2) + -1 * (Complex.sin (ϑ / 2 : ℝ) / 2))) =
      (1 - Real.sin ϑ) / 4
    rw [neg_one_mul, Complex.normSq_mul, hn_phase, one_mul]
    rw [← Complex.ofReal_cos, ← Complex.ofReal_sin]
    norm_cast
    rw [Complex.normSq_ofReal]
    nlinarith
  have hp3 : Complex.normSq (psiTwoByTwoClosed ϑ 3) = (1 + Real.sin ϑ) / 4 := by
    dsimp only [psiTwoByTwoClosed]
    change Complex.normSq (Complex.exp (Complex.I * ((Real.pi / 4 : ℝ) : ℂ)) *
        ((Complex.cos (ϑ / 2 : ℝ) / 2) + 1 * (Complex.sin (ϑ / 2 : ℝ) / 2))) =
      (1 + Real.sin ϑ) / 4
    rw [one_mul, Complex.normSq_mul, hn_phase, one_mul]
    rw [← Complex.ofReal_cos, ← Complex.ofReal_sin]
    norm_cast
    rw [Complex.normSq_ofReal]
    nlinarith
  refine ⟨hp0, hp1, hp2, hp3, ?_, ?_, ?_⟩ <;> linarith


/-- `ϑ_L = u_L / 2`. -/
noncomputable def varthetaL (L : ℕ) : ℝ := uL L / 2

/-- Corollary 4.4 (3): `Corr(Z_b, Z_o) = sin ϑ_L` for the general circuit at `n_b = n_o = 1`. -/
theorem cor_4_4_corr (L : ℕ) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    msbCorr 0 0 L = Real.sin (varthetaL L) := by
  obtain ⟨hu0, hupi, -, -⟩ := uL_bounds L hL1 hL6
  have hs : 0 < Real.sin (uL L / 2) :=
    Real.sin_pos_of_pos_of_lt_pi (by linarith) (by linarith [Real.pi_pos])
  rw [msbCorr, thm_4_3_msb_corr 0 0 L hL1 hL6, varthetaL]
  simp only [zero_add, max_self, min_self, pow_one]
  rw [show uL L * 2 / 4 = uL L / 2 by ring, show uL L * 2 / (2 * 2) = uL L / 2 by ring]
  field_simp
  ring

private theorem pushPair_msb_zero (φ : ℝ) (J : Fin 1 ⊕ Fin 1 → Fin 1 ⊕ Fin 1 → ℝ)
    (y : Fin 1 ⊕ Fin 1 → Fin 2) :
    pushPair (msb 0) (msb 0) (jointLaw 1 1 φ J) (y (.inl 0), y (.inr 0)) = born φ J y := by
  rw [pushPair, Finset.sum_eq_single (y ∘ .inl, y ∘ .inr)]
  · rw [jointLaw]
    congr 1
    funext r
    rcases r with j | l <;> simp [Fin.fin_one_eq_zero]
  · intro x hx hne
    rw [Finset.mem_filter] at hx
    simp only [Prod.mk.injEq, msb] at hx
    exact absurd (Prod.ext (funext fun i ↦ by rw [Fin.fin_one_eq_zero i]; exact hx.2.1)
      (funext fun i ↦ by rw [Fin.fin_one_eq_zero i]; exact hx.2.2)) hne
  · intro hnot
    exfalso
    apply hnot
    rw [Finset.mem_filter]
    exact ⟨Finset.mem_univ _, rfl⟩

/-- Corollary 4.4: the general circuit's Born law at `n_b = n_o = 1` is
`P_L(a, b) = (1 + s_a s_b sin ϑ_L) / 4`, matching `cor_4_4_two_by_two`. -/
theorem cor_4_4_born (L : ℕ) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) (y : Fin 1 ⊕ Fin 1 → Fin 2) :
    born (-(Real.pi / 4)) (coupling 1 1 L) y =
      (1 + spin (y (.inl 0)) * spin (y (.inr 0)) * Real.sin (varthetaL L)) / 4 := by
  rw [← pushPair_msb_zero, thm_4_3_msb_law 0 0, ← cor_4_4_corr L hL1 hL6, msbCorr]

/-- Corollary 4.4 (1): `ρ_B^(0) = ½ I + ½ cos ϑ X` has eigenvalues `(1 ± cos ϑ) / 2` with
eigenvectors `|+⟩ = (1, 1)` and `|-⟩ = (1, -1)`. -/
theorem cor_4_4_rhoB_eigen (ϑ : ℝ) :
    let ρ : Matrix (Fin 2) (Fin 2) ℝ := !![1 / 2, Real.cos ϑ / 2; Real.cos ϑ / 2, 1 / 2]
    ρ.mulVec ![1, 1] = ((1 + Real.cos ϑ) / 2) • ![1, 1] ∧
      ρ.mulVec ![1, -1] = ((1 - Real.cos ϑ) / 2) • ![1, -1] := by
  intro ρ
  constructor <;> ext i <;> fin_cases i <;>
    simp [ρ, Matrix.mulVec, dotProduct, Fin.sum_univ_two] <;> ring

/-- Corollary 4.4 (1): `S(ρ_B) = h((1 + cos ϑ_L) / 2) > 0`. -/
theorem cor_4_4_entropy_pos (L : ℕ) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    0 < Real.binEntropy ((1 + Real.cos (varthetaL L)) / 2) := by
  obtain ⟨hu0, hupi, -, -⟩ := uL_bounds L hL1 hL6
  have hc0 : 0 < Real.cos (varthetaL L) :=
    Real.cos_pos_of_mem_Ioo ⟨by unfold varthetaL; linarith [Real.pi_pos],
      by unfold varthetaL; linarith⟩
  have hc1 : Real.cos (varthetaL L) < 1 := by
    rw [← Real.cos_zero]
    exact Real.cos_lt_cos_of_nonneg_of_le_pi_div_two le_rfl (by unfold varthetaL; linarith)
      (by unfold varthetaL; linarith)
  exact Real.binEntropy_pos (by linarith) (by linarith)

/-- Corollary 4.4 (3): `sin ϑ_L` is strictly increasing in `L`. -/
theorem cor_4_4_sin_strictMono (L L' : ℕ) (hL1 : 1 ≤ L) (hLL : L < L') (hL6 : L' ≤ 6) :
    Real.sin (varthetaL L) < Real.sin (varthetaL L') := by
  obtain ⟨hu0, -, -, -⟩ := uL_bounds L hL1 (by omega)
  obtain ⟨-, hupi', -, -⟩ := uL_bounds L' (by omega) hL6
  have hlt : uL L < uL L' := by
    unfold uL
    exact mul_lt_mul_of_pos_left (Real.sqrt_lt_sqrt (by positivity) (by exact_mod_cast hLL))
      (inv_pos.mpr Real.goldenRatio_pos)
  unfold varthetaL
  exact Real.sin_lt_sin_of_lt_of_le_pi_div_two (by linarith [Real.pi_pos]) (by linarith)
    (by linarith)

/-- Corollary 4.4 (3): the printed range `0.304 < sin ϑ_1` and `sin ϑ_6 < 0.687`. -/
theorem cor_4_4_sin_bounds : (304 / 1000 : ℝ) < Real.sin (varthetaL 1) ∧
    Real.sin (varthetaL 6) < 687 / 1000 := by
  obtain ⟨lo1, -⟩ := uL_encl_1
  obtain ⟨-, hi6⟩ := uL_encl_6
  have hlo : (309 / 1000 : ℝ) < varthetaL 1 := by unfold varthetaL; norm_num at lo1 ⊢; linarith
  have hhi : varthetaL 6 < 37848 / 50000 := by unfold varthetaL; norm_num at hi6 ⊢; linarith
  have hpos : 0 < varthetaL 6 := by
    obtain ⟨h0, -, -, -⟩ := uL_bounds 6 (by norm_num) le_rfl
    unfold varthetaL
    linarith
  have hx1 : varthetaL 1 < 1 := by
    obtain ⟨-, h1, -, -⟩ := uL_bounds 1 le_rfl (by norm_num)
    unfold varthetaL
    linarith [Real.pi_lt_d2]
  constructor
  · have h := Real.sin_gt_sub_cube (by linarith : 0 < varthetaL 1)
    have key : 0 < (varthetaL 1 - 309 / 1000) *
        (6 - varthetaL 1 ^ 2 - varthetaL 1 * (309 / 1000) - (309 / 1000) ^ 2) :=
      mul_pos (by linarith) (by nlinarith)
    nlinarith [key, h]
  · set y := varthetaL 6 / 2
    have hy0 : 0 < y := by positivity
    have hy1 : y < 37848 / 100000 := by simp only [y]; linarith
    have hsin2 : Real.sin (varthetaL 6) = 2 * Real.sin y * Real.cos y := by
      rw [← Real.sin_two_mul]
      simp only [y]
      ring_nf
    have hsb := Real.sin_bound (x := y) (by rw [abs_of_pos hy0]; linarith)
    have hcb := Real.cos_bound (x := y) (by rw [abs_of_pos hy0]; linarith)
    rw [abs_of_pos hy0] at hsb hcb
    have hs_up : Real.sin y ≤ y - y ^ 3 / 6 + y ^ 5 / 100 := by
      linarith [le_abs_self (Real.sin y - (y - y ^ 3 / 6))]
    have hc_up : Real.cos y ≤ 1 - y ^ 2 / 2 + y ^ 4 * (5 / 96) := by
      linarith [le_abs_self (Real.cos y - (1 - y ^ 2 / 2))]
    have hs0 : 0 < Real.sin y := Real.sin_pos_of_pos_of_lt_pi hy0 (by linarith [Real.pi_gt_three])
    have hc0 : 0 < Real.cos y := Real.cos_pos_of_mem_Ioo ⟨by linarith [Real.pi_gt_three],
      by linarith [Real.pi_gt_three]⟩
    rw [hsin2]
    have hpoly : 2 * (y - y ^ 3 / 6 + y ^ 5 / 100) * (1 - y ^ 2 / 2 + y ^ 4 * (5 / 96)) <
        687 / 1000 := by
      have hy2 : y ^ 2 < (37848 / 100000) ^ 2 := by gcongr
      nlinarith [pow_pos hy0 3, pow_pos hy0 4, pow_pos hy0 5, pow_pos hy0 6, pow_pos hy0 7,
        pow_pos hy0 8, pow_pos hy0 9]
    calc 2 * Real.sin y * Real.cos y ≤
        2 * (y - y ^ 3 / 6 + y ^ 5 / 100) * (1 - y ^ 2 / 2 + y ^ 4 * (5 / 96)) := by
          gcongr
          · nlinarith
      _ < 687 / 1000 := hpoly

/-- Corollary 4.4 (3): `I(B; O) = log 2 - h((1 + sin ϑ_L) / 2) > 0` nats at `n_b = n_o = 1`. -/
theorem cor_4_4_mutualInfo (L : ℕ) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    mutualInfo (jointLaw 1 1 (-(Real.pi / 4)) (coupling 1 1 L)) =
        Real.log 2 - Real.binEntropy ((1 + Real.sin (varthetaL L)) / 2) ∧
      0 < Real.log 2 - Real.binEntropy ((1 + Real.sin (varthetaL L)) / 2) := by
  have hadm : Admissible (0 + 1) (0 + 1) L := ⟨le_rfl, by norm_num, le_rfl, by norm_num,
    by norm_num, hL1, hL6⟩
  obtain ⟨-, hpos⟩ := thm_4_3_mutualInfo_pos 0 0 L hadm
  have hpush : pushPair (msb 0) (msb 0) (jointLaw 1 1 (-(Real.pi / 4)) (coupling 1 1 L)) =
      pushPair (Equiv.funUnique (Fin 1) (Fin 2)) (Equiv.funUnique (Fin 1) (Fin 2))
        (jointLaw 1 1 (-(Real.pi / 4)) (coupling 1 1 L)) := rfl
  rw [← mutualInfo_pushPair_equiv (Equiv.funUnique (Fin 1) (Fin 2))
    (Equiv.funUnique (Fin 1) (Fin 2)), ← hpush, ← cor_4_4_corr L hL1 hL6]
  exact ⟨thm_4_3_msb_mutualInfo 0 0 _ _, hpos⟩

end

end BotgeLean
