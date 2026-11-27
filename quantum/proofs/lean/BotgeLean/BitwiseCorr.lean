/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.Correlations
import Mathlib.Algebra.Order.Ring.Star
import Mathlib.Algebra.Order.Star.Real
import Mathlib.Analysis.SpecialFunctions.Trigonometric.Complex
import Mathlib.Tactic.Monotonicity.Lemmas
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Botge's bitwise correlations (Theorem 4.3 (1)–(2), `thm:bitwise-corr`)

Specializes the Ising two-point function to Botge's couplings `θ_{bo,j,l}` on
`Fin n_b ⊕ Fin n_o`:

* `eq:bitwise-corr`: the cross-register correlation for every uniform readout `Rx(φ)`, and the
  unique optimality of `φ = -π/4` (ported from the scratch proof);
* `eq:intra-corr`: the intra-register correlations of both registers at `φ = -π/4`, via
  Morrie's identity (`eq:morrie`, ported from the scratch proof);
* uniform marginals `P(B < N_b / 2) = 1/2` and `P(B < M_b) ≥ 1/2`, and complement invariance of
  the joint law on register values.

`Corr` of two `±1` observables is `(E[fg] - E[f] E[g]) / √(Var f Var g)`; every Pauli-`Z` bit has
mean `0` and variance `1`, so `Corr = Cov = E[Z Z]`.
-/

open Complex Finset Function

namespace BotgeLean

@[expose] public section

section General

variable {ι : Type*} [Fintype ι] [DecidableEq ι]

/-- Pearson correlation of two observables under the Born law. -/
noncomputable def corr (φ : ℝ) (J : ι → ι → ℝ) (f g : (ι → Fin 2) → ℝ) : ℝ :=
  (expect φ J (fun y ↦ f y * g y) - expect φ J f * expect φ J g) /
    Real.sqrt ((expect φ J (fun y ↦ f y ^ 2) - expect φ J f ^ 2) *
      (expect φ J (fun y ↦ g y ^ 2) - expect φ J g ^ 2))

/-- Relabelling the qubits along `e` leaves every correlation unchanged. -/
theorem corr_relabel {ι' : Type*} [Fintype ι'] [DecidableEq ι'] (e : ι' ≃ ι) (φ : ℝ)
    (J : ι → ι → ℝ) (f g : (ι → Fin 2) → ℝ) :
    corr φ (fun p q ↦ J (e p) (e q)) (fun y ↦ f (y ∘ e.symm)) (fun y ↦ g (y ∘ e.symm)) =
      corr φ J f g := by
  simp only [corr]
  rw [expect_relabel e φ J (fun y ↦ f y * g y), expect_relabel e φ J f, expect_relabel e φ J g,
    expect_relabel e φ J (fun y ↦ f y ^ 2), expect_relabel e φ J (fun y ↦ g y ^ 2)]

/-- Pauli-`Z` bits have mean `0` and variance `1`, so `Corr(Z_p, Z_q) = Cov(Z_p, Z_q)
= E[Z_p Z_q]`. -/
theorem corr_spin (φ : ℝ) (J : ι → ι → ℝ) (p q : ι) :
    corr φ J (fun y ↦ spin (y p)) (fun y ↦ spin (y q)) =
      expect φ J (fun y ↦ spin (y p) * spin (y q)) := by
  have hsq : ∀ r : ι, expect φ J (fun y ↦ spin (y r) ^ 2) = 1 := by
    intro r
    simp only [expect, sq, spin_mul_self, mul_one, sum_born]
  simp [corr, thm_4_3_mean_spin, hsq]

end General

/-- Morrie's telescoping cosine product (`eq:morrie`), ported from the scratch proof. -/
theorem thm_4_3_morrie (m : ℕ) (x : ℝ) :
    (∏ k ∈ Finset.range m, Real.cos ((2 : ℝ) ^ k * x)) * ((2 : ℝ) ^ m * Real.sin x) =
      Real.sin ((2 : ℝ) ^ m * x) := by
  induction m with
  | zero => simp
  | succ k ih =>
    rw [Finset.prod_range_succ, pow_succ (2 : ℝ) k]
    calc
      (∏ j ∈ Finset.range k, Real.cos ((2 : ℝ) ^ j * x)) * Real.cos ((2 : ℝ) ^ k * x) *
          ((2 : ℝ) ^ k * 2 * Real.sin x)
        = ((∏ j ∈ Finset.range k, Real.cos ((2 : ℝ) ^ j * x)) * ((2 : ℝ) ^ k * Real.sin x)) *
            (2 * Real.cos ((2 : ℝ) ^ k * x)) := by ring
      _ = Real.sin ((2 : ℝ) ^ k * x) * (2 * Real.cos ((2 : ℝ) ^ k * x)) := by rw [ih]
      _ = 2 * Real.sin ((2 : ℝ) ^ k * x) * Real.cos ((2 : ℝ) ^ k * x) := by ring
      _ = Real.sin (2 * ((2 : ℝ) ^ k * x)) := (Real.sin_two_mul ((2 : ℝ) ^ k * x)).symm
      _ = Real.sin ((2 : ℝ) ^ k * 2 * x) := congrArg Real.sin (by ring)

/-- Theorem 4.3 (2): the prefactor `-sin 2φ` attains its maximum `1` on `[-π/2, π/2]` exactly at
`φ = -π/4` (ported from the scratch proof). -/
theorem thm_4_3_optimal_rx (φ : ℝ) (hφ : φ ∈ Set.Icc (-(Real.pi / 2)) (Real.pi / 2)) :
    -Real.sin (2 * φ) ≤ 1 ∧ (-Real.sin (2 * φ) = 1 ↔ φ = -(Real.pi / 4)) := by
  constructor
  · linarith [Real.neg_one_le_sin (2 * φ)]
  · constructor
    · intro heq
      have hneg1 : Real.sin (2 * φ) = -1 := by linarith
      obtain ⟨k, hk⟩ := Real.sin_eq_neg_one_iff.mp hneg1
      have hk_gt : (-1 : ℝ) < k := by nlinarith [Real.pi_pos, hφ.1, hφ.2]
      have hk_lt : (k : ℝ) < 1 := by nlinarith [Real.pi_pos, hφ.1, hφ.2]
      have hk0 : k = 0 := by
        have h1 : (-1 : ℤ) < k := by exact_mod_cast hk_gt
        have h2 : k < (1 : ℤ) := by exact_mod_cast hk_lt
        omega
      subst hk0
      simp only [Int.cast_zero, zero_mul, add_zero] at hk
      linarith
    · intro hval
      rw [hval, show 2 * -(Real.pi / 4) = -(Real.pi / 2) by ring, Real.sin_neg,
        Real.sin_pi_div_two]
      norm_num

section Botge

variable (nb no L : ℕ)

/-- The qubits other than `b_j` and `o_l`: every other qubit of both registers. -/
theorem rest_inl_inr (j : Fin nb) (l : Fin no) :
    rest (Sum.inl j : Fin nb ⊕ Fin no) (Sum.inr l) =
      ((univ.erase j).map Embedding.inl).disjUnion ((univ.erase l).map Embedding.inr)
        (by simp [Finset.disjoint_left]) := by
  ext r
  rcases r with j' | l' <;> simp [rest, and_comm]

/-- The qubits other than `b_j` and `b_j'`. -/
theorem rest_inl_inl (j j' : Fin nb) :
    rest (Sum.inl j : Fin nb ⊕ Fin no) (Sum.inl j') =
      (((univ.erase j).erase j').map Embedding.inl).disjUnion (univ.map Embedding.inr)
        (by simp [Finset.disjoint_left]) := by
  ext r
  rcases r with i | l' <;> simp [rest, and_comm]

/-- Theorem 4.3 (2), `eq:bitwise-corr`: for every uniform readout `Rx(φ)` and cross-register pair,
`Corr_φ(Z_{b,j}, Z_{o,l}) = -(sin 2φ / 2) sin |θ_{jl}|
  (∏_{j' ≠ j} cos θ_{j'l} + ∏_{l' ≠ l} cos θ_{jl'})`. -/
theorem thm_4_3_bitwise_corr (φ : ℝ) (j : Fin nb) (l : Fin no) (hL : 1 ≤ L) :
    corr φ (coupling nb no L) (fun y ↦ spin (y (.inl j))) (fun y ↦ spin (y (.inr l))) =
      -(Real.sin (2 * φ) / 2) * Real.sin |theta nb no L j l| *
        (∏ j' ∈ univ.erase j, Real.cos (theta nb no L j' l) +
          ∏ l' ∈ univ.erase l, Real.cos (theta nb no L j l')) := by
  rw [corr_spin, isingTwoPoint φ _ (coupling_symm nb no L) (coupling_self nb no L)
    Sum.inl_ne_inr, rest_inl_inr]
  simp only [prod_disjUnion, prod_map, Embedding.inl_apply, Embedding.inr_apply, coupling,
    Real.cos_zero, prod_const_one, one_mul, mul_one, sub_zero, zero_sub, Real.cos_neg, add_zero]
  rw [abs_of_neg (prop_3_2_theta_neg nb no L hL j l), Real.sin_neg]
  ring_nf

/-- Theorem 4.3 (2): the optimal readout `φ = -π/4` gives
`Corr(Z_{b,j}, Z_{o,l}) = ½ sin |θ_{jl}| (∏_{j' ≠ j} cos θ_{j'l} + ∏_{l' ≠ l} cos θ_{jl'})`. -/
theorem thm_4_3_bitwise_corr_optimal (j : Fin nb) (l : Fin no) (hL : 1 ≤ L) :
    corr (-(Real.pi / 4)) (coupling nb no L) (fun y ↦ spin (y (.inl j)))
        (fun y ↦ spin (y (.inr l))) =
      (1 / 2) * Real.sin |theta nb no L j l| *
        (∏ j' ∈ univ.erase j, Real.cos (theta nb no L j' l) +
          ∏ l' ∈ univ.erase l, Real.cos (theta nb no L j l')) := by
  rw [thm_4_3_bitwise_corr nb no L _ j l hL, show 2 * -(Real.pi / 4) = -(Real.pi / 2) by ring,
    Real.sin_neg, Real.sin_pi_div_two]
  ring

/-- `sin² (-π/4) = 1/2`. -/
theorem sin_sq_neg_pi_div_four : Real.sin (-(Real.pi / 4)) ^ 2 = 1 / 2 := by
  rw [Real.sin_neg, neg_sq, Real.sin_pi_div_four, div_pow, Real.sq_sqrt (by norm_num)]
  norm_num

/-- `sin (2 * (-π/4)) = -1`. -/
theorem sin_two_mul_neg_pi_div_four : Real.sin (2 * -(Real.pi / 4)) = -1 := by
  rw [show 2 * -(Real.pi / 4) = -(Real.pi / 2) by ring, Real.sin_neg, Real.sin_pi_div_two]

/-- Morrie's identity over a register: `∏_{l < n} cos (2^l x) = sin (2^n x) / (2^n sin x)`. -/
theorem prod_cos_two_pow (n : ℕ) (x : ℝ) (hx : Real.sin x ≠ 0) :
    ∏ l : Fin n, Real.cos ((2 : ℝ) ^ (l : ℕ) * x) =
      Real.sin ((2 : ℝ) ^ n * x) / ((2 : ℝ) ^ n * Real.sin x) := by
  rw [Fin.prod_univ_eq_prod_range (fun l ↦ Real.cos ((2 : ℝ) ^ l * x)) n,
    eq_div_iff (mul_ne_zero (by positivity) hx)]
  exact thm_4_3_morrie n x

/-- Theorem 4.3 (`eq:intra-corr`): Strict domain `(0, 3Real.pi/8)` for intra-register angles. -/
theorem thm_4_3_intra_angle_pos (j jp nb Nmax : ℕ) (hjj : j < jp) (hjp : jp < nb)
    (hmax : 2 ^ nb ≤ Nmax) (uL : ℝ) (hu0 : 0 < uL) (hupi : uL < Real.pi / 2) :
    let xm := uL * ((2 : ℝ) ^ jp - (2 : ℝ) ^ j) / (Nmax : ℝ)
    let xp := uL * ((2 : ℝ) ^ jp + (2 : ℝ) ^ j) / (Nmax : ℝ)
    0 < xm ∧ xm < xp ∧ xp < 3 * Real.pi / 8 ∧ 0 < Real.sin xm ∧ 0 < Real.sin xp := by
  dsimp only
  have h2j_pos : (0 : ℝ) < (2 : ℝ) ^ j := by positivity
  have hpow_lt : 2 ^ j < 2 ^ jp := Nat.pow_lt_pow_right (by decide) hjj
  have h2j_lt : (2 : ℝ) ^ j < (2 : ℝ) ^ jp := by exact_mod_cast hpow_lt
  have hNmax_pos_nat : 0 < Nmax := by
    have : 0 < 2 ^ nb := pow_pos (by decide) nb
    omega
  have hNmax_pos : (0 : ℝ) < Nmax := by exact_mod_cast hNmax_pos_nat
  have h2_mul_j_le_jp : 2 * 2 ^ j ≤ 2 ^ jp := by
    have hj1 : j + 1 ≤ jp := hjj
    calc
      2 * 2 ^ j = 2 ^ (j + 1) := by rw [pow_succ, mul_comm]
      _ ≤ 2 ^ jp := Nat.pow_le_pow_right (by decide) hj1
  have h2_mul_jp_le_nb : 2 * 2 ^ jp ≤ 2 ^ nb := by
    have hjp1 : jp + 1 ≤ nb := hjp
    calc
      2 * 2 ^ jp = 2 ^ (jp + 1) := by rw [pow_succ, mul_comm]
      _ ≤ 2 ^ nb := Nat.pow_le_pow_right (by decide) hjp1
  have hbound_nat : 4 * (2 ^ jp + 2 ^ j) ≤ 3 * Nmax := by omega
  have hbound_real : 4 * ((2 : ℝ) ^ jp + (2 : ℝ) ^ j) ≤ 3 * (Nmax : ℝ) :=
    by exact_mod_cast hbound_nat
  have hfrac_le : ((2 : ℝ) ^ jp + (2 : ℝ) ^ j) / (Nmax : ℝ) ≤ 3 / 4 := by
    rw [div_le_iff₀ hNmax_pos]
    linarith
  have hxm_pos : 0 < uL * ((2 : ℝ) ^ jp - (2 : ℝ) ^ j) / (Nmax : ℝ) := by
    have : 0 < (2 : ℝ) ^ jp - (2 : ℝ) ^ j := by linarith
    positivity
  have hxm_lt_xp : uL * ((2 : ℝ) ^ jp - (2 : ℝ) ^ j) / (Nmax : ℝ) <
      uL * ((2 : ℝ) ^ jp + (2 : ℝ) ^ j) / (Nmax : ℝ) := by
    apply div_lt_div_of_pos_right _ hNmax_pos
    apply mul_lt_mul_of_pos_left _ hu0
    linarith
  have hxp_lt : uL * ((2 : ℝ) ^ jp + (2 : ℝ) ^ j) / (Nmax : ℝ) < 3 * Real.pi / 8 := by
    calc
      uL * ((2 : ℝ) ^ jp + (2 : ℝ) ^ j) / (Nmax : ℝ)
        = uL * (((2 : ℝ) ^ jp + (2 : ℝ) ^ j) / (Nmax : ℝ)) := by ring
      _ ≤ uL * (3 / 4) := mul_le_mul_of_nonneg_left hfrac_le hu0.le
      _ < (Real.pi / 2) * (3 / 4) := by linarith
      _ = 3 * Real.pi / 8 := by ring
  have hsin_xm : 0 < Real.sin (uL * ((2 : ℝ) ^ jp - (2 : ℝ) ^ j) / (Nmax : ℝ)) :=
    Real.sin_pos_of_pos_of_lt_pi hxm_pos (by linarith [Real.pi_pos])
  have hsin_xp : 0 < Real.sin (uL * ((2 : ℝ) ^ jp + (2 : ℝ) ^ j) / (Nmax : ℝ)) :=
    Real.sin_pos_of_pos_of_lt_pi (lt_trans hxm_pos hxm_lt_xp) (by linarith [Real.pi_pos])
  exact ⟨hxm_pos, hxm_lt_xp, hxp_lt, hsin_xm, hsin_xp⟩

/-- Theorem 4.3 (2), `eq:intra-corr` for the base register: at `φ = -π/4` and `j < j'`,
`Corr(Z_{b,j}, Z_{b,j'}) = ¼ (sin (N_o x₋) / (N_o sin x₋) - sin (N_o x₊) / (N_o sin x₊))` with
`x_± = u_L (2^{j'} ± 2^j) / max(N_b, N_o)`. -/
theorem thm_4_3_intra_corr_base (j j' : Fin nb) (hjj : j < j') (hL : 1 ≤ L) (hL6 : L ≤ 6) :
    let xm := uL L * ((2 : ℝ) ^ (j' : ℕ) - 2 ^ (j : ℕ)) / 2 ^ max nb no
    let xp := uL L * ((2 : ℝ) ^ (j' : ℕ) + 2 ^ (j : ℕ)) / 2 ^ max nb no
    corr (-(Real.pi / 4)) (coupling nb no L) (fun y ↦ spin (y (.inl j)))
        (fun y ↦ spin (y (.inl j'))) =
      (1 / 4) * (Real.sin ((2 : ℝ) ^ no * xm) / ((2 : ℝ) ^ no * Real.sin xm) -
        Real.sin ((2 : ℝ) ^ no * xp) / ((2 : ℝ) ^ no * Real.sin xp)) := by
  intro xm xp
  obtain ⟨hu0, hupi, -, -⟩ := uL_bounds L hL hL6
  have hang := thm_4_3_intra_angle_pos (j : ℕ) j' nb (2 ^ max nb no) hjj j'.isLt
    (Nat.pow_le_pow_right (by norm_num) (le_max_left _ _)) (uL L) hu0 hupi
  simp only [Nat.cast_pow, Nat.cast_ofNat] at hang
  obtain ⟨-, -, -, hsm, hsp⟩ := hang
  rw [corr_spin, isingTwoPoint _ _ (coupling_symm nb no L) (coupling_self nb no L)
    (fun h ↦ (ne_of_lt hjj) (Sum.inl_injective h)), rest_inl_inl]
  simp only [prod_disjUnion, prod_map, Embedding.inl_apply, Embedding.inr_apply, coupling,
    Real.sin_zero, mul_zero, zero_mul, zero_add, sub_zero, add_zero, Real.cos_zero,
    prod_const_one, one_mul, sin_sq_neg_pi_div_four]
  have hminus : ∀ l : Fin no, Real.cos (theta nb no L j l - theta nb no L j' l) =
      Real.cos ((2 : ℝ) ^ (l : ℕ) * xm) := by
    intro l
    congr 1
    simp only [theta, xm]
    ring
  have hplus : ∀ l : Fin no, Real.cos (theta nb no L j l + theta nb no L j' l) =
      Real.cos ((2 : ℝ) ^ (l : ℕ) * xp) := by
    intro l
    rw [← Real.cos_neg]
    congr 1
    simp only [theta, xp]
    ring
  simp only [hminus, hplus, prod_cos_two_pow no xm hsm.ne', prod_cos_two_pow no xp hsp.ne']
  ring

/-- Theorem 4.3 (2), `eq:intra-corr` for the overlay register: at `φ = -π/4` and `l < l'`,
`Corr(Z_{o,l}, Z_{o,l'}) = ¼ (sin (N_b x₋) / (N_b sin x₋) - sin (N_b x₊) / (N_b sin x₊))` with
`x_± = u_L (2^{l'} ± 2^l) / max(N_b, N_o)`. -/
theorem thm_4_3_intra_corr_overlay (l l' : Fin no) (hll : l < l') (hL : 1 ≤ L) (hL6 : L ≤ 6) :
    let xm := uL L * ((2 : ℝ) ^ (l' : ℕ) - 2 ^ (l : ℕ)) / 2 ^ max nb no
    let xp := uL L * ((2 : ℝ) ^ (l' : ℕ) + 2 ^ (l : ℕ)) / 2 ^ max nb no
    corr (-(Real.pi / 4)) (coupling nb no L) (fun y ↦ spin (y (.inr l)))
        (fun y ↦ spin (y (.inr l'))) =
      (1 / 4) * (Real.sin ((2 : ℝ) ^ nb * xm) / ((2 : ℝ) ^ nb * Real.sin xm) -
        Real.sin ((2 : ℝ) ^ nb * xp) / ((2 : ℝ) ^ nb * Real.sin xp)) := by
  intro xm xp
  have hJ : coupling nb no L =
      fun p q ↦ coupling no nb L (Equiv.sumComm _ _ p) (Equiv.sumComm _ _ q) :=
    funext fun p ↦ funext fun q ↦ coupling_swap no nb L p q
  rw [hJ]
  refine (corr_relabel (Equiv.sumComm (Fin nb) (Fin no)) _ (coupling no nb L)
    (fun z ↦ spin (z (.inl l))) (fun z ↦ spin (z (.inl l')))).trans ?_
  have h := thm_4_3_intra_corr_base no nb L l l' hll hL hL6
  rw [max_comm no nb] at h
  exact h

end Botge

end

end BotgeLean
