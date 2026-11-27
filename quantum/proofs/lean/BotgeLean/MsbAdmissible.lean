/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.BitwiseCorr
public import BotgeLean.Budget
public import BotgeLean.Information
public import Mathlib.Analysis.SpecialFunctions.BinaryEntropy
import Mathlib.Algebra.BigOperators.Field
import Mathlib.Algebra.Order.Star.Real
import Mathlib.Analysis.Real.Pi.Bounds
import Mathlib.Tactic.Monotonicity.Lemmas
import Mathlib.Tactic.ReduceModChar

/-!
# Positive most-significant-bit correlation on Botge's admissible domain (Theorem 4.3 (3))

At the optimal readout, Morrie's identity collapses `eq:bitwise-corr` at the most-significant bits
to `eq:msb-corr`:

`Corr(Z_{b,n_b-1}, Z_{o,n_o-1}) = sin² (u_L N_min / 4)
  (1 / (N_max sin (u_L N_min / (2 N_max))) + 1 / (N_min sin (u_L / 2)))`.

The `.tex` proves strict positivity for all widths with the Lindemann–Weierstrass theorem. This
formalization is scoped to Botge's admissible domain (`n_b ∈ 1..10`, `n_o ∈ 1..7`,
`n_b + n_o ≤ 16`, `L ∈ 1..6`) and declares no axioms: `N_min = 2^m` with `m ∈ 1..7`, so
`sin (u_L 2^m / 4) ≠ 0` is decided for each of the 42 pairs `(m, L)` by locating
`u_L 2^m / 4` strictly between consecutive multiples of `π`, using rational enclosures of `√5`,
`√L` and Mathlib's `Real.pi_gt_d4` / `Real.pi_lt_d4`. The worst case `(m, L) = (3, 6)` keeps a
margin of about `0.114` below `π`.
-/

open Finset Function

namespace BotgeLean

@[expose] public section

/-- Theorem 4.3 (`eq:msb-corr`): Morrie reduction of `eq:bitwise-corr` at `(n_b - 1, n_o - 1)`
(ported from the scratch proof; `Nmax`/`Nmin` are the register-width exponents). -/
theorem thm_4_3_msb_collapse (nb no : ℕ) (hnb : 1 ≤ nb) (hno : 1 ≤ no) (u : ℝ)
    (hu0 : 0 < u) (hupi : u < Real.pi / 2) :
    let Nmax := max nb no;
    let Nmin := min nb no;
    -(Real.sin (2 * -(Real.pi / 4)) / 2) * Real.sin (u * (2 : ℝ) ^ Nmin / 4) *
        ((∏ j' ∈ Finset.range (nb - 1),
            Real.cos (u * (2 : ℝ) ^ j' * (2 : ℝ) ^ (no - 1) / (2 : ℝ) ^ Nmax)) +
          (∏ l' ∈ Finset.range (no - 1),
            Real.cos (u * (2 : ℝ) ^ (nb - 1) * (2 : ℝ) ^ l' / (2 : ℝ) ^ Nmax))) =
      Real.sin (u * (2 : ℝ) ^ Nmin / 4) ^ 2 *
        (1 / ((2 : ℝ) ^ Nmax * Real.sin (u * (2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax))) +
          1 / ((2 : ℝ) ^ Nmin * Real.sin (u / 2))) := by
  dsimp only
  have hsin_pref : -(Real.sin (2 * -(Real.pi / 4)) / 2) = (1 / 2 : ℝ) := by
    have h2 : 2 * -(Real.pi / 4) = -(Real.pi / 2) := by ring
    rw [h2, Real.sin_neg, Real.sin_pi_div_two]
    ring
  rw [hsin_pref]
  have hsin_half_ne : Real.sin (u / 2) ≠ 0 :=
    (Real.sin_pos_of_pos_of_lt_pi (by linarith) (by linarith [Real.pi_pos])).ne'
  wlog hle : no ≤ nb generalizing nb no
  · have h := this no nb hno hnb (Nat.le_of_not_le hle)
    rw [max_comm, min_comm] at h
    refine Eq.trans ?_ h
    rw [add_comm]
    congr 2 <;> exact Finset.prod_congr rfl fun _ _ ↦ congrArg Real.cos (by ring)
  rw [max_eq_left hle, min_eq_right hle]
  have h2A : (2 : ℝ) ^ nb = 2 * (2 : ℝ) ^ (nb - 1) := by
    have : nb = (nb - 1) + 1 := by omega
    conv_lhs => rw [this, pow_succ, mul_comm]
  have h2B : (2 : ℝ) ^ no = 2 * (2 : ℝ) ^ (no - 1) := by
    have : no = (no - 1) + 1 := by omega
    conv_lhs => rw [this, pow_succ, mul_comm]
  have hpow_le : (2 : ℝ) ^ no ≤ (2 : ℝ) ^ nb :=
    by exact_mod_cast Nat.pow_le_pow_right (by decide) hle
  have hx1_pos : 0 < u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb) := by positivity
  have hx1_lt : u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb) < Real.pi := by
    have hdiv_le : (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb) ≤ 1 / 2 := by
      rw [div_le_div_iff₀ (by positivity) (by positivity)]
      linarith
    calc
      u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb) = u * ((2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb)) := by ring
      _ ≤ u * (1 / 2) := mul_le_mul_of_nonneg_left hdiv_le hu0.le
      _ < Real.pi := by linarith [Real.pi_pos]
  have hx1_sin_ne : Real.sin (u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb)) ≠ 0 :=
    (Real.sin_pos_of_pos_of_lt_pi hx1_pos hx1_lt).ne'
  have hm1 := thm_4_3_morrie (nb - 1) (u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb))
  have hm1_arg : ∀ j' : ℕ,
      u * (2 : ℝ) ^ j' * (2 : ℝ) ^ (no - 1) / (2 : ℝ) ^ nb =
        (2 : ℝ) ^ j' * (u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb)) := by
    intro j'
    rw [h2B]
    field_simp
  have hm1_rhs : (2 : ℝ) ^ (nb - 1) * (u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb)) =
      u * (2 : ℝ) ^ no / 4 := by
    rw [h2A]
    field_simp
    ring
  rw [hm1_rhs] at hm1
  have hprod1 :
      ∏ j' ∈ Finset.range (nb - 1),
          Real.cos (u * (2 : ℝ) ^ j' * (2 : ℝ) ^ (no - 1) / (2 : ℝ) ^ nb) =
        Real.sin (u * (2 : ℝ) ^ no / 4) /
          ((2 : ℝ) ^ (nb - 1) * Real.sin (u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb))) := by
    have hcg :
        (∏ j' ∈ Finset.range (nb - 1),
            Real.cos (u * (2 : ℝ) ^ j' * (2 : ℝ) ^ (no - 1) / (2 : ℝ) ^ nb)) =
          ∏ j' ∈ Finset.range (nb - 1),
            Real.cos ((2 : ℝ) ^ j' * (u * (2 : ℝ) ^ no / (2 * (2 : ℝ) ^ nb))) :=
      Finset.prod_congr rfl fun j' _ => congrArg Real.cos (hm1_arg j')
    rw [hcg, eq_div_iff (mul_ne_zero (by positivity) hx1_sin_ne)]
    exact hm1
  have hm2 := thm_4_3_morrie (no - 1) (u / 2)
  have hm2_arg : ∀ l' : ℕ,
      u * (2 : ℝ) ^ (nb - 1) * (2 : ℝ) ^ l' / (2 : ℝ) ^ nb = (2 : ℝ) ^ l' * (u / 2) := by
    intro l'
    rw [h2A]
    field_simp
  have hm2_rhs : (2 : ℝ) ^ (no - 1) * (u / 2) = u * (2 : ℝ) ^ no / 4 := by
    rw [h2B]
    ring
  rw [hm2_rhs] at hm2
  have hprod2 :
      ∏ l' ∈ Finset.range (no - 1),
          Real.cos (u * (2 : ℝ) ^ (nb - 1) * (2 : ℝ) ^ l' / (2 : ℝ) ^ nb) =
        Real.sin (u * (2 : ℝ) ^ no / 4) / ((2 : ℝ) ^ (no - 1) * Real.sin (u / 2)) := by
    have hcg :
        (∏ l' ∈ Finset.range (no - 1),
            Real.cos (u * (2 : ℝ) ^ (nb - 1) * (2 : ℝ) ^ l' / (2 : ℝ) ^ nb)) =
          ∏ l' ∈ Finset.range (no - 1), Real.cos ((2 : ℝ) ^ l' * (u / 2)) :=
      Finset.prod_congr rfl fun l' _ => congrArg Real.cos (hm2_arg l')
    rw [hcg, eq_div_iff (mul_ne_zero (by positivity) hsin_half_ne)]
    exact hm2
  rw [hprod1, hprod2, h2A, h2B]
  field_simp



/-- `sin x ≠ 0` once `x` lies strictly between `k π` and `(k + 1) π`, certified with the
four-digit enclosure `3.1415 < π < 3.1416`. -/
theorem sin_ne_zero_of_enclosure {u lo hi c : ℝ} (k : ℕ) (hu : lo < u ∧ u < hi)
    (hc : 0 < c := by norm_num) (h1 : (k : ℝ) * (31416 / 10000) ≤ lo * c := by norm_num)
    (h2 : hi * c ≤ ((k : ℝ) + 1) * (31415 / 10000) := by norm_num) :
    Real.sin (u * c) ≠ 0 := by
  have hpi1 := Real.pi_gt_d4
  have hpi2 := Real.pi_lt_d4
  have hk : (0 : ℝ) ≤ k := Nat.cast_nonneg k
  have hlow : (k : ℝ) * Real.pi < u * c := by nlinarith [mul_lt_mul_of_pos_right hu.1 hc]
  have hhigh : u * c < ((k : ℝ) + 1) * Real.pi := by nlinarith [mul_lt_mul_of_pos_right hu.2 hc]
  intro hsin
  obtain ⟨n, hn⟩ := Real.sin_eq_zero_iff.mp hsin
  rw [← hn] at hlow hhigh
  have hlt1 : (k : ℝ) < n := lt_of_mul_lt_mul_right hlow Real.pi_pos.le
  have hlt2 : (n : ℝ) < k + 1 := lt_of_mul_lt_mul_right hhigh Real.pi_pos.le
  have hz1 : (k : ℤ) < n := by exact_mod_cast hlt1
  have hz2 : n < (k : ℤ) + 1 := by exact_mod_cast hlt2
  omega

/-- Rational enclosure of `u_L = φ⁻¹ √L` from a rational enclosure `a < √L < b`, using
`2.23606 < √5 < 2.23607`. -/
theorem uL_encl_of_sqrt {L : ℕ} {a b : ℝ} (ha0 : 0 ≤ a) (ha : a ^ 2 < L) (hb0 : 0 < b)
    (hb : (L : ℝ) < b ^ 2) :
    (223606 / 100000 - 1) / 2 * a < uL L ∧ uL L < (223607 / 100000 - 1) / 2 * b := by
  have h5a : (223606 / 100000 : ℝ) < Real.sqrt 5 := by
    rw [Real.lt_sqrt (by norm_num)]
    norm_num
  have h5b : Real.sqrt 5 < 223607 / 100000 := by
    rw [Real.sqrt_lt' (by norm_num)]
    norm_num
  have hLa : a < Real.sqrt L := (Real.lt_sqrt ha0).mpr ha
  have hLb : Real.sqrt L < b := (Real.sqrt_lt' hb0).mpr hb
  rw [uL, goldenRatio_inv_eq]
  constructor
  · nlinarith [mul_nonneg (sub_pos.mpr h5a).le (Real.sqrt_nonneg (L : ℝ)),
      mul_pos (show (0 : ℝ) < (223606 / 100000 - 1) / 2 by norm_num) (sub_pos.mpr hLa)]
  · nlinarith [mul_nonneg (sub_pos.mpr h5b).le (Real.sqrt_nonneg (L : ℝ)),
      mul_pos (show (0 : ℝ) < (223607 / 100000 - 1) / 2 by norm_num) (sub_pos.mpr hLb)]

/-- Rational enclosure of `u_1`. -/
theorem uL_encl_1 :
    (6180238197 / 10000000000 : ℝ) < uL 1 ∧ uL 1 < 12360823607 / 20000000000 := by
  have h := uL_encl_of_sqrt (L := 1) (a := 99999 / 100000) (b := 100001 / 100000)
    (by norm_num) (by norm_num) (by norm_num) (by norm_num)
  norm_num at h ⊢
  exact h

/-- Rational enclosure of `u_2`. -/
theorem uL_encl_2 :
    (8740242063 / 10000000000 : ℝ) < uL 2 ∧ uL 2 < 8740374577 / 10000000000 := by
  have h := uL_encl_of_sqrt (L := 2) (a := 141421 / 100000) (b := 141422 / 100000)
    (by norm_num) (by norm_num) (by norm_num) (by norm_num)
  norm_num at h ⊢
  exact h

/-- Rational enclosure of `u_3`. -/
theorem uL_encl_3 :
    (2140917723 / 2000000000 : ℝ) < uL 3 ∧ uL 3 < 10704737021 / 10000000000 := by
  have h := uL_encl_of_sqrt (L := 3) (a := 173205 / 100000) (b := 173206 / 100000)
    (by norm_num) (by norm_num) (by norm_num) (by norm_num)
  norm_num at h ⊢
  exact h

/-- Rational enclosure of `u_4`. -/
theorem uL_encl_4 :
    (12360538197 / 10000000000 : ℝ) < uL 4 ∧ uL 4 < 24721523607 / 20000000000 := by
  have h := uL_encl_of_sqrt (L := 4) (a := 199999 / 100000) (b := 200001 / 100000)
    (by norm_num) (by norm_num) (by norm_num) (by norm_num)
  norm_num at h ⊢
  exact h

/-- Rational enclosure of `u_5`. -/
theorem uL_encl_5 :
    (6909760809 / 5000000000 : ℝ) < uL 5 ∧ uL 5 < 27639390449 / 20000000000 := by
  have h := uL_encl_of_sqrt (L := 5) (a := 223606 / 100000) (b := 223607 / 100000)
    (by norm_num) (by norm_num) (by norm_num) (by norm_num)
  norm_num at h ⊢
  exact h

/-- Rational enclosure of `u_6`. -/
theorem uL_encl_6 :
    (3784630311 / 2500000000 : ℝ) < uL 6 ∧ uL 6 < 30277411043 / 20000000000 := by
  have h := uL_encl_of_sqrt (L := 6) (a := 244948 / 100000) (b := 244949 / 100000)
    (by norm_num) (by norm_num) (by norm_num) (by norm_num)
  norm_num at h ⊢
  exact h

/-- Theorem 4.3 (3) on the admissible domain: `sin (u_L 2^m / 4) ≠ 0` for every `m ∈ 1..7` and
`L ∈ 1..6`, the 42 pairs `(min(n_b, n_o), L)` that Botge can reach. -/
theorem sin_msb_ne_zero (m L : ℕ) (hm1 : 1 ≤ m) (hm7 : m ≤ 7) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    Real.sin (uL L * 2 ^ m / 4) ≠ 0 := by
  rw [mul_div_assoc]
  interval_cases m <;> interval_cases L
  · exact sin_ne_zero_of_enclosure 0 uL_encl_1
  · exact sin_ne_zero_of_enclosure 0 uL_encl_2
  · exact sin_ne_zero_of_enclosure 0 uL_encl_3
  · exact sin_ne_zero_of_enclosure 0 uL_encl_4
  · exact sin_ne_zero_of_enclosure 0 uL_encl_5
  · exact sin_ne_zero_of_enclosure 0 uL_encl_6
  · exact sin_ne_zero_of_enclosure 0 uL_encl_1
  · exact sin_ne_zero_of_enclosure 0 uL_encl_2
  · exact sin_ne_zero_of_enclosure 0 uL_encl_3
  · exact sin_ne_zero_of_enclosure 0 uL_encl_4
  · exact sin_ne_zero_of_enclosure 0 uL_encl_5
  · exact sin_ne_zero_of_enclosure 0 uL_encl_6
  · exact sin_ne_zero_of_enclosure 0 uL_encl_1
  · exact sin_ne_zero_of_enclosure 0 uL_encl_2
  · exact sin_ne_zero_of_enclosure 0 uL_encl_3
  · exact sin_ne_zero_of_enclosure 0 uL_encl_4
  · exact sin_ne_zero_of_enclosure 0 uL_encl_5
  · exact sin_ne_zero_of_enclosure 0 uL_encl_6
  · exact sin_ne_zero_of_enclosure 0 uL_encl_1
  · exact sin_ne_zero_of_enclosure 1 uL_encl_2
  · exact sin_ne_zero_of_enclosure 1 uL_encl_3
  · exact sin_ne_zero_of_enclosure 1 uL_encl_4
  · exact sin_ne_zero_of_enclosure 1 uL_encl_5
  · exact sin_ne_zero_of_enclosure 1 uL_encl_6
  · exact sin_ne_zero_of_enclosure 1 uL_encl_1
  · exact sin_ne_zero_of_enclosure 2 uL_encl_2
  · exact sin_ne_zero_of_enclosure 2 uL_encl_3
  · exact sin_ne_zero_of_enclosure 3 uL_encl_4
  · exact sin_ne_zero_of_enclosure 3 uL_encl_5
  · exact sin_ne_zero_of_enclosure 3 uL_encl_6
  · exact sin_ne_zero_of_enclosure 3 uL_encl_1
  · exact sin_ne_zero_of_enclosure 4 uL_encl_2
  · exact sin_ne_zero_of_enclosure 5 uL_encl_3
  · exact sin_ne_zero_of_enclosure 6 uL_encl_4
  · exact sin_ne_zero_of_enclosure 7 uL_encl_5
  · exact sin_ne_zero_of_enclosure 7 uL_encl_6
  · exact sin_ne_zero_of_enclosure 6 uL_encl_1
  · exact sin_ne_zero_of_enclosure 8 uL_encl_2
  · exact sin_ne_zero_of_enclosure 10 uL_encl_3
  · exact sin_ne_zero_of_enclosure 12 uL_encl_4
  · exact sin_ne_zero_of_enclosure 14 uL_encl_5
  · exact sin_ne_zero_of_enclosure 15 uL_encl_6

/-- Theorem 4.3 (3), `eq:msb-corr` positivity on Botge's admissible domain, without axioms. -/
theorem thm_4_3_msb_pos_admissible (nb no L : ℕ) (h : Admissible nb no L) :
    let u := uL L
    let Nmax := max nb no
    let Nmin := min nb no
    0 < Real.sin (u * (2 : ℝ) ^ Nmin / 4) ^ 2 *
      (1 / ((2 : ℝ) ^ Nmax * Real.sin (u * (2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax))) +
        1 / ((2 : ℝ) ^ Nmin * Real.sin (u / 2))) := by
  obtain ⟨hnb1, -, hno1, hno7, -, hL1, hL6⟩ := h
  intro u Nmax Nmin
  obtain ⟨hu0, hupi, -, -⟩ := uL_bounds L hL1 hL6
  have hpow_le : (2 : ℝ) ^ Nmin ≤ (2 : ℝ) ^ Nmax :=
    pow_le_pow_right₀ (by norm_num) min_le_max
  have hx1_pos : 0 < u * (2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax) := by positivity
  have hx1_lt : u * (2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax) < Real.pi := by
    have hdiv : (2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax) ≤ 1 / 2 := by
      rw [div_le_div_iff₀ (by positivity) (by positivity)]
      linarith
    calc u * (2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax)
        = u * ((2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax)) := by ring
      _ ≤ u * (1 / 2) := mul_le_mul_of_nonneg_left hdiv hu0.le
      _ < Real.pi := by linarith [Real.pi_pos]
  have hden1 : 0 < (2 : ℝ) ^ Nmax * Real.sin (u * (2 : ℝ) ^ Nmin / (2 * (2 : ℝ) ^ Nmax)) :=
    mul_pos (by positivity) (Real.sin_pos_of_pos_of_lt_pi hx1_pos hx1_lt)
  have hden2 : 0 < (2 : ℝ) ^ Nmin * Real.sin (u / 2) :=
    mul_pos (by positivity) (Real.sin_pos_of_pos_of_lt_pi (by linarith) (by linarith))
  have hsin : Real.sin (u * (2 : ℝ) ^ Nmin / 4) ≠ 0 :=
    sin_msb_ne_zero Nmin L (le_min hnb1 hno1) ((min_le_right _ _).trans hno7) hL1 hL6
  have hsq : 0 < Real.sin (u * (2 : ℝ) ^ Nmin / 4) ^ 2 := by positivity
  positivity

/-- `∏` over `Fin (n + 1)` without its last index is the `range n` product. -/
theorem prod_erase_last (n : ℕ) (f : ℕ → ℝ) :
    ∏ j ∈ (univ : Finset (Fin (n + 1))).erase (Fin.last n), f j = ∏ j ∈ range n, f j := by
  rw [← Finset.compl_singleton, ← Fin.image_castSucc,
    Finset.prod_image fun a _ b _ h ↦ Fin.castSucc_injective n h]
  exact Fin.prod_univ_eq_prod_range (fun j ↦ f j) n

/-- Theorem 4.3 (3), `eq:msb-corr`: at the optimal readout, the most-significant-bit correlation
equals `sin² (u_L N_min / 4) (1 / (N_max sin (u_L N_min / (2 N_max))) +
1 / (N_min sin (u_L / 2)))` (register widths `n_b = n + 1`, `n_o = m + 1`). -/
theorem thm_4_3_msb_corr (n m L : ℕ) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    corr (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L) (fun y ↦ spin (y (.inl (Fin.last n))))
        (fun y ↦ spin (y (.inr (Fin.last m)))) =
      Real.sin (uL L * (2 : ℝ) ^ min (n + 1) (m + 1) / 4) ^ 2 *
        (1 / ((2 : ℝ) ^ max (n + 1) (m + 1) *
            Real.sin (uL L * (2 : ℝ) ^ min (n + 1) (m + 1) / (2 * (2 : ℝ) ^ max (n + 1) (m + 1)))) +
          1 / ((2 : ℝ) ^ min (n + 1) (m + 1) * Real.sin (uL L / 2))) := by
  obtain ⟨hu0, hupi, -, -⟩ := uL_bounds L hL1 hL6
  have key := thm_4_3_msb_collapse (n + 1) (m + 1) (by omega) (by omega) (uL L) hu0 hupi
  simp only [Nat.add_sub_cancel] at key
  rw [thm_4_3_bitwise_corr_optimal _ _ L _ _ hL1, ← key, sin_two_mul_neg_pi_div_four]
  have habs : |theta (n + 1) (m + 1) L (Fin.last n) (Fin.last m)| =
      uL L * (2 : ℝ) ^ min (n + 1) (m + 1) / 4 := by
    rw [abs_of_neg (prop_3_2_theta_neg _ _ L hL1 _ _), theta, neg_neg, Fin.val_last,
      Fin.val_last]
    have hpow : (2 : ℝ) ^ n * 2 ^ m * 4 = 2 ^ max (n + 1) (m + 1) * 2 ^ min (n + 1) (m + 1) := by
      rw [← pow_add, show (4 : ℝ) = 2 ^ 2 by norm_num, ← pow_add, ← pow_add]
      congr 1
      omega
    field_simp
    linear_combination hpow
  have hB : ∏ j' ∈ univ.erase (Fin.last n), Real.cos (theta (n + 1) (m + 1) L j' (Fin.last m)) =
      ∏ j' ∈ range n,
        Real.cos (uL L * (2 : ℝ) ^ j' * (2 : ℝ) ^ m / (2 : ℝ) ^ max (n + 1) (m + 1)) := by
    rw [← prod_erase_last n (fun j' ↦
      Real.cos (uL L * (2 : ℝ) ^ j' * (2 : ℝ) ^ m / (2 : ℝ) ^ max (n + 1) (m + 1)))]
    refine Finset.prod_congr rfl fun j' _ ↦ ?_
    rw [theta, Real.cos_neg, Fin.val_last]
  have hO : ∏ l' ∈ univ.erase (Fin.last m), Real.cos (theta (n + 1) (m + 1) L (Fin.last n) l') =
      ∏ l' ∈ range m,
        Real.cos (uL L * (2 : ℝ) ^ n * (2 : ℝ) ^ l' / (2 : ℝ) ^ max (n + 1) (m + 1)) := by
    rw [← prod_erase_last m (fun l' ↦
      Real.cos (uL L * (2 : ℝ) ^ n * (2 : ℝ) ^ l' / (2 : ℝ) ^ max (n + 1) (m + 1)))]
    refine Finset.prod_congr rfl fun l' _ ↦ ?_
    rw [theta, Real.cos_neg, Fin.val_last]
  rw [habs, hB, hO]
  ring

/-- Theorem 4.3 (3): the most-significant-bit correlation is strictly positive on Botge's
admissible domain. -/
theorem thm_4_3_msb_corr_pos (n m L : ℕ) (h : Admissible (n + 1) (m + 1) L) :
    0 < corr (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L)
      (fun y ↦ spin (y (.inl (Fin.last n)))) (fun y ↦ spin (y (.inr (Fin.last m)))) := by
  rw [thm_4_3_msb_corr n m L h.2.2.2.2.2.1 h.2.2.2.2.2.2]
  exact thm_4_3_msb_pos_admissible _ _ L h

/-- The joint Born law of the two register values `(B, O)`. -/
noncomputable def jointLaw (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → Fin nb ⊕ Fin no → ℝ)
    (x : (Fin nb → Fin 2) × (Fin no → Fin 2)) : ℝ :=
  born φ J (Sum.elim x.1 x.2)

/-- The most significant bit of an `(n + 1)`-qubit register. -/
def msb (n : ℕ) (x : Fin (n + 1) → Fin 2) : Fin 2 := x (Fin.last n)

private theorem indicator_spin (a b : Fin 2) :
    (if b = a then (1 : ℝ) else 0) = (1 + spin a * spin b) / 2 := by
  fin_cases a <;> fin_cases b <;> norm_num [spin]

/-- Theorem 4.3 (3): the most-significant bits have the joint law `(1 ± c) / 4` with
`c = Corr(Z_{b,n_b-1}, Z_{o,n_o-1})`. -/
theorem thm_4_3_msb_law (n m : ℕ) (φ : ℝ) (J : Fin (n + 1) ⊕ Fin (m + 1) → _ → ℝ)
    (a b : Fin 2) :
    pushPair (msb n) (msb m) (jointLaw (n + 1) (m + 1) φ J) (a, b) =
      (1 + spin a * spin b *
        corr φ J (fun y ↦ spin (y (.inl (Fin.last n)))) (fun y ↦ spin (y (.inr (Fin.last m))))) /
        4 := by
  rw [corr_spin]
  have hsum : pushPair (msb n) (msb m) (jointLaw (n + 1) (m + 1) φ J) (a, b) =
      ∑ y, born φ J y * ((1 + spin a * spin (y (.inl (Fin.last n)))) / 2 *
        ((1 + spin b * spin (y (.inr (Fin.last m)))) / 2)) := by
    rw [pushPair, Finset.sum_filter,
      ← (Equiv.sumArrowEquivProdArrow (Fin (n + 1)) (Fin (m + 1)) (Fin 2)).sum_comp]
    refine Finset.sum_congr rfl fun y _ ↦ ?_
    have hy : jointLaw (n + 1) (m + 1) φ J (Equiv.sumArrowEquivProdArrow _ _ _ y) = born φ J y :=
      congrArg (born φ J) ((Equiv.sumArrowEquivProdArrow _ _ _).symm_apply_apply y)
    rw [hy]
    simp only [msb, Equiv.sumArrowEquivProdArrow_apply_fst, Equiv.sumArrowEquivProdArrow_apply_snd,
      Prod.mk.injEq, ← indicator_spin]
    split_ifs <;> simp_all
  have hmean1 := thm_4_3_mean_spin φ J (.inl (Fin.last n))
  have hmean2 := thm_4_3_mean_spin φ J (.inr (Fin.last m))
  have hone := sum_born φ J
  rw [hsum]
  simp only [expect] at hmean1 hmean2 ⊢
  have : ∀ y, born φ J y * ((1 + spin a * spin (y (.inl (Fin.last n)))) / 2 *
      ((1 + spin b * spin (y (.inr (Fin.last m)))) / 2)) =
      (born φ J y + spin a * (born φ J y * spin (y (.inl (Fin.last n)))) +
        spin b * (born φ J y * spin (y (.inr (Fin.last m)))) +
        spin a * spin b *
          (born φ J y * (spin (y (.inl (Fin.last n))) * spin (y (.inr (Fin.last m)))))) / 4 :=
    fun y ↦ by ring
  simp only [this, ← Finset.sum_div, Finset.sum_add_distrib, ← Finset.mul_sum, hmean1, hmean2,
    hone]
  ring

/-- The mutual information of the most-significant bits is `log 2 - h((1 + c) / 2)` nats. -/
theorem thm_4_3_msb_mutualInfo (n m : ℕ) (φ : ℝ) (J : Fin (n + 1) ⊕ Fin (m + 1) → _ → ℝ) :
    let c := corr φ J (fun y ↦ spin (y (.inl (Fin.last n)))) (fun y ↦ spin (y (.inr (Fin.last m))))
    mutualInfo (pushPair (msb n) (msb m) (jointLaw (n + 1) (m + 1) φ J)) =
      Real.log 2 - Real.binEntropy ((1 + c) / 2) := by
  intro c
  set Q := pushPair (msb n) (msb m) (jointLaw (n + 1) (m + 1) φ J)
  have hQ : ∀ a b, Q (a, b) = (1 + spin a * spin b * c) / 4 := thm_4_3_msb_law n m φ J
  have hmL : ∀ a, margL Q a = 1 / 2 := by
    intro a
    rw [margL, Fin.sum_univ_two, hQ, hQ]
    fin_cases a <;> norm_num [spin] <;> ring
  have hmR : ∀ b, margR Q b = 1 / 2 := by
    intro b
    rw [margR, Fin.sum_univ_two, hQ, hQ]
    fin_cases b <;> norm_num [spin] <;> ring
  have hQ00 : Q (0, 0) = (1 + c) / 4 := by rw [hQ]; norm_num [spin]
  have hQ01 : Q (0, 1) = (1 - c) / 4 := by rw [hQ]; norm_num [spin]; ring
  have hQ10 : Q (1, 0) = (1 - c) / 4 := by rw [hQ]; norm_num [spin]; ring
  have hQ11 : Q (1, 1) = (1 + c) / 4 := by rw [hQ]; norm_num [spin]
  rw [mutualInfo, Fintype.sum_prod_type]
  simp only [hmL, hmR, Fin.sum_univ_two, hQ00, hQ01, hQ10, hQ11]
  set p := (1 + c) / 2 with hp
  have e1 : (1 + c) / 4 / (1 / 2 * (1 / 2)) = 2 * p := by rw [hp]; ring
  have e2 : (1 - c) / 4 / (1 / 2 * (1 / 2)) = 2 * (1 - p) := by rw [hp]; ring
  have e3 : (1 + c) / 4 = p / 2 := by rw [hp]; ring
  have e4 : (1 - c) / 4 = (1 - p) / 2 := by rw [hp]; ring
  rw [e1, e2, e3, e4, Real.binEntropy_eq_negMulLog_add_negMulLog_one_sub]
  simp only [Real.negMulLog]
  rcases eq_or_ne p 0 with h0 | h0 <;> rcases eq_or_ne (1 - p) 0 with h1 | h1
  · simp [h0] at h1
  · rw [h0]
    norm_num
    ring
  · have hp1 : p = 1 := by linarith
    rw [hp1]
    norm_num
    ring
  · rw [Real.log_mul two_ne_zero h0, Real.log_mul two_ne_zero h1]
    ring

/-- Theorem 4.3 (3), `eq:mi-lower`: on Botge's admissible domain,
`I(B; O) ≥ I(B_{n_b-1}; O_{n_o-1}) = log 2 - h((1 + c) / 2) > 0` (nats). -/
theorem thm_4_3_mutualInfo_pos (n m L : ℕ) (h : Admissible (n + 1) (m + 1) L) :
    let c := corr (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L)
      (fun y ↦ spin (y (.inl (Fin.last n)))) (fun y ↦ spin (y (.inr (Fin.last m))))
    Real.log 2 - Real.binEntropy ((1 + c) / 2) ≤
        mutualInfo (jointLaw (n + 1) (m + 1) (-(Real.pi / 4)) (coupling (n + 1) (m + 1) L)) ∧
      0 < Real.log 2 - Real.binEntropy ((1 + c) / 2) := by
  intro c
  refine ⟨?_, ?_⟩
  · rw [← thm_4_3_msb_mutualInfo]
    exact mutualInfo_pushPair_le _ _ _ fun x ↦ born_nonneg _ _ _
  · have hc : 0 < c := thm_4_3_msb_corr_pos n m L h
    have hne : (1 + c) / 2 ≠ 2⁻¹ := by
      intro heq
      have : c = 0 := by linarith
      exact hc.ne' this
    exact sub_pos.mpr (Real.binEntropy_lt_log_two.mpr hne)

/-- Theorem 4.3 (1): joint complement invariance on register values,
`P_L(N_b - 1 - x_b, N_o - 1 - x_o) = P_L(x_b, x_o)`. -/
theorem thm_4_3_jointLaw_compl (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ)
    (x : (Fin nb → Fin 2) × (Fin no → Fin 2)) :
    jointLaw nb no φ J (complEquiv _ x.1, complEquiv _ x.2) = jointLaw nb no φ J x ∧
      (finFunctionFinEquiv (complEquiv _ x.1) : ℕ) = 2 ^ nb - 1 - finFunctionFinEquiv x.1 ∧
      (finFunctionFinEquiv (complEquiv _ x.2) : ℕ) = 2 ^ no - 1 - finFunctionFinEquiv x.2 := by
  refine ⟨?_, finFunctionFinEquiv_compl _, finFunctionFinEquiv_compl _⟩
  have h : Sum.elim (complEquiv _ x.1) (complEquiv _ x.2) =
      complEquiv (Fin nb ⊕ Fin no) (Sum.elim x.1 x.2) := by
    funext r
    rcases r with j | l <;> rfl
  rw [jointLaw, jointLaw, h, thm_4_3_born_compl]

/-- Theorem 4.3 (1): palindromic base marginal `P_B(N_b - 1 - x_b) = P_B(x_b)`. -/
theorem thm_4_3_margL_compl (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ)
    (xb : Fin nb → Fin 2) :
    margL (jointLaw nb no φ J) (complEquiv _ xb) = margL (jointLaw nb no φ J) xb := by
  rw [margL, margL, ← (complEquiv (Fin no)).sum_comp]
  exact Finset.sum_congr rfl fun xo _ ↦ (thm_4_3_jointLaw_compl nb no φ J (xb, xo)).1

/-- Theorem 4.3 (1): palindromic overlay marginal `P_O(N_o - 1 - x_o) = P_O(x_o)`. -/
theorem thm_4_3_margR_compl (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ)
    (xo : Fin no → Fin 2) :
    margR (jointLaw nb no φ J) (complEquiv _ xo) = margR (jointLaw nb no φ J) xo := by
  rw [margR, margR, ← (complEquiv (Fin nb)).sum_comp]
  exact Finset.sum_congr rfl fun xb _ ↦ (thm_4_3_jointLaw_compl nb no φ J (xb, xo)).1

private theorem sum_jointLaw_eq_prob (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → _ → ℝ)
    (E : (Fin nb ⊕ Fin no → Fin 2) → Prop) [DecidablePred E] :
    ∑ x with E (Sum.elim x.1 x.2), jointLaw nb no φ J x = prob φ J E := by
  rw [prob, Finset.sum_filter, Finset.sum_filter,
    ← (Equiv.sumArrowEquivProdArrow (Fin nb) (Fin no) (Fin 2)).symm.sum_comp]
  rfl

/-- Theorem 4.3 (1): the lower half of the base register has probability exactly `1/2`,
`P(B < N_b / 2) = 1/2`. -/
theorem thm_4_3_base_lower_half (n no : ℕ) (φ : ℝ) (J : Fin (n + 1) ⊕ Fin no → _ → ℝ) :
    ∑ x with (finFunctionFinEquiv x.1 : ℕ) < 2 ^ n, jointLaw (n + 1) no φ J x = 1 / 2 := by
  rw [← thm_4_3_uniform_bit φ J (.inl (Fin.last n)),
    ← sum_jointLaw_eq_prob (n + 1) no φ J (fun y ↦ y (.inl (Fin.last n)) = 0)]
  refine Finset.sum_congr ?_ fun _ _ ↦ rfl
  ext x
  rw [Finset.mem_filter, Finset.mem_filter]
  simp only [Finset.mem_univ, true_and, Sum.elim_inl]
  exact finFunctionFinEquiv_lt_half_iff x.1

/-- Theorem 4.3 (1): the lower half of the overlay register has probability exactly `1/2`. -/
theorem thm_4_3_overlay_lower_half (nb m : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin (m + 1) → _ → ℝ) :
    ∑ x with (finFunctionFinEquiv x.2 : ℕ) < 2 ^ m, jointLaw nb (m + 1) φ J x = 1 / 2 := by
  rw [← thm_4_3_uniform_bit φ J (.inr (Fin.last m)),
    ← sum_jointLaw_eq_prob nb (m + 1) φ J (fun y ↦ y (.inr (Fin.last m)) = 0)]
  refine Finset.sum_congr ?_ fun _ _ ↦ rfl
  ext x
  rw [Finset.mem_filter, Finset.mem_filter]
  simp only [Finset.mem_univ, true_and, Sum.elim_inr]
  exact finFunctionFinEquiv_lt_half_iff x.2

/-- Theorem 4.3 (1): every admissible base domain `M_b ≥ N_b / 2` has `P(B < M_b) ≥ 1/2`. -/
theorem thm_4_3_base_domain_half (n no : ℕ) (φ : ℝ) (J : Fin (n + 1) ⊕ Fin no → _ → ℝ)
    (M : ℕ) (hM : 2 ^ n ≤ M) :
    1 / 2 ≤ ∑ x with (finFunctionFinEquiv x.1 : ℕ) < M, jointLaw (n + 1) no φ J x := by
  rw [← thm_4_3_base_lower_half n no φ J]
  exact Finset.sum_le_sum_of_subset_of_nonneg
    (Finset.monotone_filter_right _ fun x _ h ↦ lt_of_lt_of_le h hM)
    (fun x _ _ ↦ born_nonneg _ _ _)

/-- Theorem 4.3 (1): every admissible overlay domain `M_o ≥ N_o / 2` has `P(O < M_o) ≥ 1/2`. -/
theorem thm_4_3_overlay_domain_half (nb m : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin (m + 1) → _ → ℝ)
    (M : ℕ) (hM : 2 ^ m ≤ M) :
    1 / 2 ≤ ∑ x with (finFunctionFinEquiv x.2 : ℕ) < M, jointLaw nb (m + 1) φ J x := by
  rw [← thm_4_3_overlay_lower_half nb m φ J]
  exact Finset.sum_le_sum_of_subset_of_nonneg
    (Finset.monotone_filter_right _ fun x _ h ↦ lt_of_lt_of_le h hM)
    (fun x _ _ ↦ born_nonneg _ _ _)

end

end BotgeLean
