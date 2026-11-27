/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.Circuit
public import Mathlib.Analysis.Matrix.Spectrum
public import Mathlib.Analysis.SpecialFunctions.Log.NegMulLog
import BotgeLean.MsbAdmissible
import Mathlib.Algebra.Order.Star.Real
import Mathlib.Analysis.Convex.SpecificFunctions.Deriv
import Mathlib.Analysis.Matrix.PosDef
import Mathlib.Analysis.Real.Pi.Bounds
import Mathlib.Tactic.Monotonicity.Lemmas
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Toeplitz reduced state and strict non-maximal entanglement (Theorem 4.1, `thm:entanglement`)

Spectral facts come from Mathlib's Hermitian-matrix API (`IsHermitian.spectral_theorem`,
`eigenvalues`, `roots_charpoly_eq_eigenvalues`, `charpoly_mul_comm_of_le`,
`posSemidef_conjTranspose_mul_self`). The von Neumann entropy is the Shannon entropy of the
eigenvalues (nats).
-/

open Complex Finset Matrix Polynomial
open scoped ComplexOrder

namespace BotgeLean

@[expose] public section

section Spectrum

variable {n : Type*} [Fintype n] [DecidableEq n]

/-- Von Neumann entropy `S(ρ) = -∑ λ log λ` (nats) of a Hermitian matrix. -/
noncomputable def vonNeumann (A : Matrix n n ℂ) (hA : A.IsHermitian) : ℝ :=
  ∑ i, Real.negMulLog (hA.eigenvalues i)

/-- `Tr(A²) = ∑ λᵢ²` for a Hermitian matrix. -/
theorem trace_mul_self_eq (A : Matrix n n ℂ) (hA : A.IsHermitian) :
    (A * A).trace = ∑ i, ((hA.eigenvalues i : ℂ)) ^ 2 := by
  set U : Matrix n n ℂ := (hA.eigenvectorUnitary : Matrix n n ℂ)
  set D : Matrix n n ℂ := diagonal (RCLike.ofReal ∘ hA.eigenvalues)
  have hA' : A = U * D * star U := by
    conv_lhs => rw [hA.spectral_theorem, Unitary.conjStarAlgAut_apply]
  have hU : star U * U = 1 := Unitary.coe_star_mul_self _
  have hsq : A * A = U * (D * D) * star U := by
    rw [hA']
    simp only [Matrix.mul_assoc]
    rw [← Matrix.mul_assoc (star U) U, hU, Matrix.one_mul]
  rw [hsq, trace_mul_cycle, ← Matrix.mul_assoc, hU, Matrix.one_mul, diagonal_mul_diagonal,
    trace_diagonal]
  simp [sq]

/-- Theorem 4.1 (2) for a density matrix: with purity `1/n < Tr ρ² < 1`,
`0 < S₂(ρ) ≤ S(ρ) < log n`. -/
theorem vonNeumann_bounds (A : Matrix n n ℂ) (hA : A.PosSemidef) (htr : A.trace = 1)
    (hlo : 1 / (Fintype.card n : ℝ) < ((A * A).trace).re) (hhi : ((A * A).trace).re < 1) :
    0 < -Real.log ((A * A).trace).re ∧
      -Real.log ((A * A).trace).re ≤ vonNeumann A hA.isHermitian ∧
      vonNeumann A hA.isHermitian < Real.log (Fintype.card n) := by
  set p := hA.isHermitian.eigenvalues
  have hp0 : ∀ i, 0 ≤ p i := hA.eigenvalues_nonneg
  have hp1 : ∑ i, p i = 1 := by
    have := hA.isHermitian.trace_eq_sum_eigenvalues
    rw [htr] at this
    have hre := congrArg Complex.re this
    simpa using hre.symm
  have hsq : ((A * A).trace).re = ∑ i, p i ^ 2 := by
    rw [trace_mul_self_eq A hA.isHermitian]
    simp only [← Complex.ofReal_pow, ← Complex.ofReal_sum, Complex.ofReal_re]
    rfl
  have hpos : 0 < ((A * A).trace).re := lt_of_le_of_lt (by positivity) hlo
  refine ⟨by rw [neg_pos]; exact Real.log_neg hpos hhi, ?_, ?_⟩
  · rw [hsq]
    exact renyi_le_shannon p hp0 hp1
  · refine shannon_lt_log_card p hp0 hp1 ?_
    rw [← hsq]
    exact hlo.ne'

/-- The von Neumann entropy sums `-λ log λ` over the roots of the characteristic polynomial. -/
theorem vonNeumann_eq_sum_roots (A : Matrix n n ℂ) (hA : A.IsHermitian) :
    vonNeumann A hA = (A.charpoly.roots.map fun z ↦ Real.negMulLog z.re).sum := by
  rw [vonNeumann, Finset.sum_eq_multiset_sum, hA.roots_charpoly_eq_eigenvalues, Multiset.map_map]
  congr 1

/-- Hermitian matrices whose characteristic polynomials differ by a power of `X` (equal nonzero
spectra) have equal von Neumann entropy. -/
theorem vonNeumann_eq_of_charpoly {m : Type*} [Fintype m] [DecidableEq m]
    (A : Matrix m m ℂ) (hA : A.IsHermitian) (B : Matrix n n ℂ) (hB : B.IsHermitian) (k : ℕ)
    (h : A.charpoly = X ^ k * B.charpoly) : vonNeumann A hA = vonNeumann B hB := by
  rw [vonNeumann_eq_sum_roots, vonNeumann_eq_sum_roots, h,
    Polynomial.roots_mul ((monic_X_pow k).mul B.charpoly_monic).ne_zero, roots_X_pow,
    Multiset.map_add, Multiset.sum_add, Multiset.map_nsmul, Multiset.map_singleton,
    Multiset.sum_nsmul, Multiset.sum_singleton]
  simp

end Spectrum

section ScratchThm41

/-! Theorem 4.1 analytic lemmas ported from the scratch proof. -/


private theorem exp_sub_exp_neg (z : ℂ) :
    Complex.exp (Complex.I * z) - Complex.exp (-(Complex.I * z)) =
      2 * Complex.I * Complex.sin z := by
  rw [mul_comm Complex.I z, ← neg_mul]
  linear_combination (-Complex.I) * Complex.two_sin z -
    (Complex.exp (-z * Complex.I) - Complex.exp (z * Complex.I)) * Complex.I_sq

/-- Theorem 4.1: the centered Dirichlet sum over `M_N` (ported from the scratch proof). -/
theorem thm_4_1_dirichlet_sum (N : ℕ) (θ : ℝ) (hsin : Real.sin (θ / 2) ≠ 0) :
    ∑ x : Fin N, Complex.exp (Complex.I * (θ : ℂ) * ((x : ℂ) - ((N : ℂ) - 1) / 2)) =
      (Real.sin ((N : ℝ) * θ / 2) / Real.sin (θ / 2) : ℂ) := by
  have hsin_c : (Real.sin (θ / 2) : ℂ) ≠ 0 := Complex.ofReal_ne_zero.mpr hsin
  set d : ℂ := 2 * Complex.I * (Real.sin (θ / 2) : ℂ)
  have hd : d ≠ 0 := mul_ne_zero (mul_ne_zero (by norm_num) Complex.I_ne_zero) hsin_c
  have hstep : ∀ k : ℕ,
      Complex.exp (Complex.I * (θ : ℂ) * ((k : ℂ) - ((N : ℂ) - 1) / 2)) * d =
        Complex.exp (Complex.I * (θ : ℂ) * (((k + 1 : ℕ) : ℂ) - (N : ℂ) / 2)) -
          Complex.exp (Complex.I * (θ : ℂ) * ((k : ℂ) - (N : ℂ) / 2)) := by
    intro k
    have hexp := exp_sub_exp_neg ((θ / 2 : ℝ) : ℂ)
    rw [← Complex.ofReal_sin] at hexp
    have hcast : ((θ / 2 : ℝ) : ℂ) = (θ : ℂ) / 2 := by push_cast; ring
    have hd_eq : d = Complex.exp (Complex.I * ((θ / 2 : ℝ) : ℂ)) -
        Complex.exp (-(Complex.I * ((θ / 2 : ℝ) : ℂ))) := by
      dsimp only [d]
      rw [← hexp]
    rw [hd_eq, mul_sub, ← Complex.exp_add, ← Complex.exp_add, hcast]
    congr 1 <;> congr 1 <;> push_cast <;> ring
  have hsum_rng :
      ∑ x : Fin N, Complex.exp (Complex.I * (θ : ℂ) * ((x : ℂ) - ((N : ℂ) - 1) / 2)) =
        ∑ k ∈ Finset.range N,
          Complex.exp (Complex.I * (θ : ℂ) * ((k : ℂ) - ((N : ℂ) - 1) / 2)) :=
    Fin.sum_univ_eq_sum_range
      (fun k : ℕ => Complex.exp (Complex.I * (θ : ℂ) * ((k : ℂ) - ((N : ℂ) - 1) / 2))) N
  have hmul_lhs :
      (∑ x : Fin N, Complex.exp (Complex.I * (θ : ℂ) * ((x : ℂ) - ((N : ℂ) - 1) / 2))) * d =
        (Real.sin ((N : ℝ) * θ / 2) : ℂ) * (2 * Complex.I) := by
    rw [hsum_rng, Finset.sum_mul]
    have hcongr :
        ∑ k ∈ Finset.range N,
            Complex.exp (Complex.I * (θ : ℂ) * ((k : ℂ) - ((N : ℂ) - 1) / 2)) * d =
          ∑ k ∈ Finset.range N,
            (Complex.exp (Complex.I * (θ : ℂ) * (((k + 1 : ℕ) : ℂ) - (N : ℂ) / 2)) -
              Complex.exp (Complex.I * (θ : ℂ) * ((k : ℂ) - (N : ℂ) / 2))) :=
      Finset.sum_congr rfl fun k _ => hstep k
    rw [hcongr, Finset.sum_range_sub (fun k : ℕ =>
      Complex.exp (Complex.I * (θ : ℂ) * ((k : ℂ) - (N : ℂ) / 2))) N]
    have ha : Complex.I * (θ : ℂ) * ((N : ℂ) - (N : ℂ) / 2) =
        Complex.I * (((N : ℝ) * θ / 2 : ℝ) : ℂ) := by push_cast; ring
    have hb : Complex.I * (θ : ℂ) * (((0 : ℕ) : ℂ) - (N : ℂ) / 2) =
        -(Complex.I * (((N : ℝ) * θ / 2 : ℝ) : ℂ)) := by push_cast; ring
    rw [ha, hb, exp_sub_exp_neg, ← Complex.ofReal_sin]
    ring
  have hmul_rhs :
      ((Real.sin ((N : ℝ) * θ / 2) / Real.sin (θ / 2) : ℝ) : ℂ) * d =
        (Real.sin ((N : ℝ) * θ / 2) : ℂ) * (2 * Complex.I) := by
    rw [Complex.ofReal_div]
    dsimp only [d]
    field_simp [hsin_c]
  rw [← Complex.ofReal_div]
  exact mul_right_cancel₀ hd (hmul_lhs.trans hmul_rhs.symm)

private theorem sum_ico_one_sub (N : ℕ) (hN : 1 ≤ N) :
    2 * ∑ d ∈ Finset.Ico 1 N, ((N : ℝ) - d) = (N : ℝ) * ((N : ℝ) - 1) := by
  have hcast : ∑ d ∈ Finset.Ico 1 N, ((N : ℝ) - d) = ((∑ d ∈ Finset.Ico 1 N, (N - d) : ℕ) : ℝ) := by
    push_cast [Nat.cast_sum]
    exact Finset.sum_congr rfl fun d hd ↦ by
      rw [Nat.cast_sub (Finset.mem_Ico.mp hd).2.le]
  have hreflect : ∑ d ∈ Finset.Ico 1 N, (N - d) = ∑ d ∈ Finset.range N, d := by
    rw [show ∑ d ∈ Finset.Ico 1 N, (N - d) = ∑ d ∈ Finset.Ico 1 N, id (N - d) from rfl,
      Finset.sum_Ico_reflect id 1 (by omega : N ≤ N + 1), Nat.add_sub_cancel_left,
      show N + 1 - 1 = N by omega, Finset.range_eq_Ico,
      Finset.sum_eq_sum_Ico_succ_bot (show 0 < N by omega)]
    simp
  have hgauss := Finset.sum_range_id_mul_two N
  rw [hcast, hreflect]
  have : ((∑ d ∈ Finset.range N, d : ℕ) : ℝ) * 2 = (N : ℝ) * ((N : ℝ) - 1) := by
    rw [← Nat.cast_ofNat, ← Nat.cast_mul, hgauss, Nat.cast_mul, Nat.cast_sub hN, Nat.cast_one]
  linarith

/-- Theorem 4.1: Exact triangular sum normalization over off-diagonal Toeplitz pairs. -/
theorem thm_4_1_triangular_sum (N : ℕ) (hN : 1 ≤ N) :
    (1 : ℝ) / N + (2 / (N : ℝ) ^ 2) * ∑ d ∈ Finset.Ico 1 N, ((N : ℝ) - d) = 1 := by
  have hNpos : (0 : ℝ) < N := by exact_mod_cast (by omega : 0 < N)
  have hs := sum_ico_one_sub N hN
  have hdiv : ∑ d ∈ Finset.Ico 1 N, ((N : ℝ) - d) = (N : ℝ) * ((N : ℝ) - 1) / 2 := by linarith
  rw [hdiv]
  field_simp [hNpos.ne']
  ring

/-- Normalized sinc-ratio Toeplitz kernel `g_L(Δ)` on register width `Nb`. -/
noncomputable def gL (Nb : ℕ) (uL Δ : ℝ) : ℝ :=
  if Δ = 0 then 1 else Real.sin (uL * Δ) / ((Nb : ℝ) * Real.sin (uL * Δ / Nb))

/-- Theorem 4.1: Two-sided bounds on the first subdiagonal entry `g_L(1)`. -/
theorem thm_4_1_g1_bounds (Nb : ℕ) (hNb : 2 ≤ Nb) (uL : ℝ) (hu0 : 0 < uL)
    (hupi : uL < Real.pi / 2) :
    Real.sin uL / uL < gL Nb uL 1 ∧ gL Nb uL 1 ≤ Real.cos (uL / 2) := by
  have hNbpos : (0 : ℝ) < Nb := by exact_mod_cast (by omega : 0 < Nb)
  have hNb2 : (2 : ℝ) ≤ Nb := by exact_mod_cast hNb
  have hg : gL Nb uL 1 = Real.sin uL / ((Nb : ℝ) * Real.sin (uL / Nb)) := by
    simp [gL]
  rw [hg]
  have harg0 : 0 < uL / Nb := div_pos hu0 hNbpos
  have harg_pi : uL / Nb < Real.pi := by
    have hdiv_le : uL / Nb ≤ uL := div_le_self hu0.le (by linarith)
    linarith [Real.pi_pos]
  have hsin_arg_pos : 0 < Real.sin (uL / Nb) := Real.sin_pos_of_pos_of_lt_pi harg0 harg_pi
  have hsin_u_pos : 0 < Real.sin uL := Real.sin_pos_of_pos_of_lt_pi hu0 (by linarith [Real.pi_pos])
  constructor
  · have hlt : Real.sin (uL / Nb) < uL / Nb := Real.sin_lt harg0
    have hmul : (Nb : ℝ) * Real.sin (uL / Nb) < uL := by
      calc
        (Nb : ℝ) * Real.sin (uL / Nb) < (Nb : ℝ) * (uL / Nb) :=
          mul_lt_mul_of_pos_left hlt hNbpos
        _ = uL := by field_simp [hNbpos.ne']
    exact div_lt_div_of_pos_left hsin_u_pos (mul_pos hNbpos hsin_arg_pos) hmul
  · have hconc :
        (1 - 2 / (Nb : ℝ)) • Real.sin 0 + (2 / (Nb : ℝ)) • Real.sin (uL / 2) ≤
          Real.sin ((1 - 2 / (Nb : ℝ)) • (0 : ℝ) + (2 / (Nb : ℝ)) • (uL / 2)) :=
      strictConcaveOn_sin_Icc.concaveOn.2
        ⟨le_rfl, Real.pi_pos.le⟩
        ⟨by linarith, by linarith [Real.pi_pos]⟩
        (show (0 : ℝ) ≤ 1 - 2 / (Nb : ℝ) by
          have : 2 / (Nb : ℝ) ≤ 1 := (div_le_one hNbpos).2 hNb2
          linarith)
        (show (0 : ℝ) ≤ 2 / (Nb : ℝ) by positivity)
        (by ring)
    have hcomb : (1 - 2 / (Nb : ℝ)) • (0 : ℝ) + (2 / (Nb : ℝ)) • (uL / 2) = uL / Nb := by
      simp only [smul_eq_mul]
      ring
    have hcomb2 : (1 - 2 / (Nb : ℝ)) • Real.sin 0 + (2 / (Nb : ℝ)) • Real.sin (uL / 2) =
        (2 / (Nb : ℝ)) * Real.sin (uL / 2) := by
      simp only [smul_eq_mul, Real.sin_zero, mul_zero, zero_add]
    rw [hcomb, hcomb2] at hconc
    have hden_ge : 2 * Real.sin (uL / 2) ≤ (Nb : ℝ) * Real.sin (uL / Nb) := by
      calc
        2 * Real.sin (uL / 2) = (Nb : ℝ) * ((2 / (Nb : ℝ)) * Real.sin (uL / 2)) := by
          field_simp [hNbpos.ne']
        _ ≤ (Nb : ℝ) * Real.sin (uL / Nb) := mul_le_mul_of_nonneg_left hconc hNbpos.le
    have hdouble : Real.sin uL = 2 * Real.sin (uL / 2) * Real.cos (uL / 2) := by
      have : uL = 2 * (uL / 2) := by ring
      conv_lhs => rw [this, Real.sin_two_mul]
    rw [hdouble, div_le_iff₀ (mul_pos hNbpos hsin_arg_pos)]
    have hcos_nonneg : 0 ≤ Real.cos (uL / 2) :=
      (Real.cos_pos_of_mem_Ioo
        (⟨by linarith, by linarith⟩ : uL / 2 ∈ Set.Ioo (-(Real.pi / 2)) (Real.pi / 2))).le
    calc
      2 * Real.sin (uL / 2) * Real.cos (uL / 2)
        = (2 * Real.sin (uL / 2)) * Real.cos (uL / 2) := rfl
      _ ≤ ((Nb : ℝ) * Real.sin (uL / Nb)) * Real.cos (uL / 2) :=
          mul_le_mul_of_nonneg_right hden_ge hcos_nonneg
      _ = Real.cos (uL / 2) * ((Nb : ℝ) * Real.sin (uL / Nb)) := mul_comm _ _

private theorem abs_sin_nat_mul_le (m : ℕ) (x : ℝ) :
    |Real.sin ((m : ℝ) * x)| ≤ (m : ℝ) * |Real.sin x| := by
  induction m with
  | zero => simp
  | succ k ih =>
    push_cast
    rw [add_mul, one_mul, Real.sin_add]
    calc
      |Real.sin ((k : ℝ) * x) * Real.cos x + Real.cos ((k : ℝ) * x) * Real.sin x|
        ≤ |Real.sin ((k : ℝ) * x) * Real.cos x| + |Real.cos ((k : ℝ) * x) * Real.sin x| :=
          abs_add_le _ _
      _ = |Real.sin ((k : ℝ) * x)| * |Real.cos x| +
          |Real.cos ((k : ℝ) * x)| * |Real.sin x| := by
          rw [abs_mul, abs_mul]
      _ ≤ |Real.sin ((k : ℝ) * x)| * 1 + 1 * |Real.sin x| := by
          gcongr
          · exact Real.abs_cos_le_one x
          · exact Real.abs_cos_le_one ((k : ℝ) * x)
      _ ≤ (k : ℝ) * |Real.sin x| + |Real.sin x| := by linarith
      _ = ((k : ℝ) + 1) * |Real.sin x| := by ring

private theorem gL_sq_le_one (Nb : ℕ) (hNb : 2 ≤ Nb) (uL : ℝ) (hu0 : 0 < uL)
    (hupi : uL < Real.pi / 2)
    (Δ : ℕ) (hΔ1 : 1 ≤ Δ) (hΔb : Δ < Nb) :
    gL Nb uL (Δ : ℝ) ^ 2 ≤ 1 := by
  have hNbpos : (0 : ℝ) < Nb := by exact_mod_cast (by omega : 0 < Nb)
  have hΔpos : (0 : ℝ) < Δ := by exact_mod_cast (by omega : 0 < Δ)
  have hΔ_lt_b : (Δ : ℝ) < Nb := by exact_mod_cast hΔb
  have hΔ_ne : (Δ : ℝ) ≠ 0 := hΔpos.ne'
  rw [gL]
  simp only [hΔ_ne, ↓reduceIte]
  have harg_pos : 0 < uL * Δ / Nb := by positivity
  have harg_lt : uL * Δ / Nb < Real.pi := by
    have : uL * Δ / Nb < uL * Nb / Nb :=
      div_lt_div_of_pos_right (mul_lt_mul_of_pos_left hΔ_lt_b hu0) hNbpos
    have : uL * Nb / Nb = uL := by field_simp [hNbpos.ne']
    linarith [Real.pi_pos]
  have hsin_pos : 0 < Real.sin (uL * Δ / Nb) := Real.sin_pos_of_pos_of_lt_pi harg_pos harg_lt
  have hden_pos : 0 < (Nb : ℝ) * Real.sin (uL * Δ / Nb) := mul_pos hNbpos hsin_pos
  have hmul_eq : uL * (Δ : ℝ) = (Nb : ℝ) * (uL * Δ / Nb) := by field_simp [hNbpos.ne']
  have habs : |Real.sin (uL * Δ)| ≤ (Nb : ℝ) * Real.sin (uL * Δ / Nb) := by
    calc
      |Real.sin (uL * Δ)| = |Real.sin ((Nb : ℝ) * (uL * Δ / Nb))| := by
          conv_lhs => rw [hmul_eq]
      _ ≤ (Nb : ℝ) * |Real.sin (uL * Δ / Nb)| := abs_sin_nat_mul_le Nb (uL * Δ / Nb)
      _ = (Nb : ℝ) * Real.sin (uL * Δ / Nb) := by rw [abs_of_pos hsin_pos]
  have hratio : |Real.sin (uL * Δ) / ((Nb : ℝ) * Real.sin (uL * Δ / Nb))| ≤ 1 := by
    rw [abs_div, abs_of_pos hden_pos]
    exact (div_le_one hden_pos).2 habs
  have hsq : (Real.sin (uL * Δ) / ((Nb : ℝ) * Real.sin (uL * Δ / Nb))) ^ 2 =
      |Real.sin (uL * Δ) / ((Nb : ℝ) * Real.sin (uL * Δ / Nb))| ^ 2 := by rw [sq_abs]
  rw [hsq]
  nlinarith [abs_nonneg (Real.sin (uL * Δ) / ((Nb : ℝ) * Real.sin (uL * Δ / Nb)))]

/-- Theorem 4.1: Universal strict two-sided bounds on the reduced-state purity `Tr(ρ_B^2)`. -/
theorem thm_4_1_purity_bounds (Nb No : ℕ) (hNo : 2 ≤ No) (hNoNb : No ≤ Nb)
    (uL : ℝ) (hu0 : 0 < uL) (hupi : uL < Real.pi / 2) :
    let P := (1 : ℝ) / No +
      (2 / (No : ℝ) ^ 2) * ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2
    (1 : ℝ) / No + (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * (Real.sin uL / uL) ^ 2 < P ∧
      P ≤ 1 - (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * Real.sin (uL / 2) ^ 2 ∧
      (1 : ℝ) / No < P ∧ P < 1 := by
  dsimp only
  have hNb : 2 ≤ Nb := le_trans hNo hNoNb
  have hNopos : (0 : ℝ) < No := by exact_mod_cast (by omega : 0 < No)
  have hNo_sub_pos : (0 : ℝ) < (No : ℝ) - 1 := by
    have : (2 : ℝ) ≤ No := by exact_mod_cast hNo
    linarith
  have hsplit : Finset.Ico 1 No = insert 1 (Finset.Ico 2 No) := by
    ext x
    simp only [Finset.mem_Ico, Finset.mem_insert]
    omega
  have hnotmem : (1 : ℕ) ∉ Finset.Ico 2 No := by simp [Finset.mem_Ico]
  have hsum_split :
      ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 =
        ((No : ℝ) - 1) * gL Nb uL 1 ^ 2 +
          ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 := by
    rw [hsplit, Finset.sum_insert hnotmem]
    simp
  have hg1 := thm_4_1_g1_bounds Nb hNb uL hu0 hupi
  have hsinc_pos : 0 < Real.sin uL / uL :=
    div_pos (Real.sin_pos_of_pos_of_lt_pi hu0 (by linarith [Real.pi_pos])) hu0
  have hg1_pos : 0 < gL Nb uL 1 := lt_trans hsinc_pos hg1.1
  have hg1_sq_gt : (Real.sin uL / uL) ^ 2 < gL Nb uL 1 ^ 2 := by nlinarith [hg1.1]
  have hg1_sq_le : gL Nb uL 1 ^ 2 ≤ 1 - Real.sin (uL / 2) ^ 2 := by
    have hcos : gL Nb uL 1 ^ 2 ≤ Real.cos (uL / 2) ^ 2 := by nlinarith [hg1.2]
    linarith [Real.cos_sq_add_sin_sq (uL / 2)]
  have htail_nonneg : 0 ≤ ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 := by
    refine Finset.sum_nonneg fun Δ hΔ => ?_
    rw [Finset.mem_Ico] at hΔ
    have hle : (Δ : ℝ) ≤ No := by exact_mod_cast (le_of_lt hΔ.2)
    exact mul_nonneg (by linarith) (sq_nonneg _)
  have htail_le :
      ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 ≤
        ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) := by
    refine Finset.sum_le_sum fun Δ hΔ => ?_
    rw [Finset.mem_Ico] at hΔ
    have hle : (Δ : ℝ) ≤ No := by exact_mod_cast (le_of_lt hΔ.2)
    have hsq := gL_sq_le_one Nb hNb uL hu0 hupi Δ (by omega) (by omega)
    nlinarith
  have htri := thm_4_1_triangular_sum No (by omega)
  have htri_split :
      ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) =
        ((No : ℝ) - 1) + ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) := by
    rw [hsplit, Finset.sum_insert hnotmem]
    simp
  have hsin_half_pos : 0 < Real.sin (uL / 2) :=
    Real.sin_pos_of_pos_of_lt_pi (by linarith) (by linarith [Real.pi_pos])
  have hlow : (1 : ℝ) / No + (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * (Real.sin uL / uL) ^ 2 <
      (1 : ℝ) / No +
        (2 / (No : ℝ) ^ 2) * ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 := by
    rw [hsum_split]
    have hcoef_pos : 0 < 2 / (No : ℝ) ^ 2 := by positivity
    have hmain : ((No : ℝ) - 1) * (Real.sin uL / uL) ^ 2 <
        ((No : ℝ) - 1) * gL Nb uL 1 ^ 2 +
          ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 := by
      have : ((No : ℝ) - 1) * (Real.sin uL / uL) ^ 2 < ((No : ℝ) - 1) * gL Nb uL 1 ^ 2 :=
        mul_lt_mul_of_pos_left hg1_sq_gt hNo_sub_pos
      linarith
    have hmul := mul_lt_mul_of_pos_left hmain hcoef_pos
    have hrhs_eq :
        (2 / (No : ℝ) ^ 2) * (((No : ℝ) - 1) * (Real.sin uL / uL) ^ 2) =
          (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * (Real.sin uL / uL) ^ 2 := by ring
    linarith
  have hupp :
      (1 : ℝ) / No +
          (2 / (No : ℝ) ^ 2) * ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 ≤
        1 - (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * Real.sin (uL / 2) ^ 2 := by
    rw [hsum_split]
    have hcomb_sum :
        ((No : ℝ) - 1) * gL Nb uL 1 ^ 2 +
            ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 ≤
          (((No : ℝ) - 1) + ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ)) -
            ((No : ℝ) - 1) * Real.sin (uL / 2) ^ 2 := by
      have : ((No : ℝ) - 1) * gL Nb uL 1 ^ 2 ≤ ((No : ℝ) - 1) * (1 - Real.sin (uL / 2) ^ 2) :=
        mul_le_mul_of_nonneg_left hg1_sq_le hNo_sub_pos.le
      linarith
    rw [← htri_split] at hcomb_sum
    have hcoef_pos : 0 ≤ 2 / (No : ℝ) ^ 2 := by positivity
    have hmul := mul_le_mul_of_nonneg_left hcomb_sum hcoef_pos
    calc
      (1 : ℝ) / No + (2 / (No : ℝ) ^ 2) *
          (((No : ℝ) - 1) * gL Nb uL 1 ^ 2 +
            ∑ Δ ∈ Finset.Ico 2 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2)
        ≤ (1 : ℝ) / No + (2 / (No : ℝ) ^ 2) *
            (∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) -
              ((No : ℝ) - 1) * Real.sin (uL / 2) ^ 2) := by
          linarith
      _ = ((1 : ℝ) / No + (2 / (No : ℝ) ^ 2) * ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ)) -
            (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * Real.sin (uL / 2) ^ 2 := by ring
      _ = 1 - (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * Real.sin (uL / 2) ^ 2 := by rw [htri]
  have hgt_inv : (1 : ℝ) / No <
      (1 : ℝ) / No +
        (2 / (No : ℝ) ^ 2) * ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 := by
    have hterm : 0 < (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * (Real.sin uL / uL) ^ 2 := by
      positivity
    linarith
  have hlt_one :
      (1 : ℝ) / No +
          (2 / (No : ℝ) ^ 2) * ∑ Δ ∈ Finset.Ico 1 No, ((No : ℝ) - Δ) * gL Nb uL Δ ^ 2 < 1 := by
    have hterm : 0 < (2 * ((No : ℝ) - 1) / (No : ℝ) ^ 2) * Real.sin (uL / 2) ^ 2 := by positivity
    linarith
  exact ⟨hlow, hupp, hgt_inv, hlt_one⟩


end ScratchThm41

section Bipartite

variable {B O : Type*}

/-- Reduced state `ρ_B = Tr_O |ψ⟩⟨ψ| = Ψ Ψ†` of an amplitude matrix `Ψ(x_b, x_o)`. -/
def rhoB [Fintype O] (Ψ : Matrix B O ℂ) : Matrix B B ℂ := Ψ * Ψᴴ

/-- Reduced state `ρ_O(x_o, x_o') = ∑_b Ψ(b, x_o) conj Ψ(b, x_o')`, the Gram matrix of `Ψ̄`. -/
def rhoO [Fintype B] (Ψ : Matrix B O ℂ) : Matrix O O ℂ :=
  (Ψ.map (starRingEnd ℂ))ᴴ * Ψ.map (starRingEnd ℂ)

/-- Entrywise formula for `rhoO Ψ`: `∑_b Ψ(b, o) star (Ψ(b, o'))`. -/
theorem rhoO_apply [Fintype B] (Ψ : Matrix B O ℂ) (o o' : O) :
    rhoO Ψ o o' = ∑ b, Ψ b o * star (Ψ b o') := by
  simp [rhoO, Matrix.mul_apply, Matrix.conjTranspose_apply]

/-- `rhoO Ψ = (Ψᴴ * Ψ)ᵀ`. -/
theorem rhoO_eq_transpose [Fintype B] (Ψ : Matrix B O ℂ) : rhoO Ψ = (Ψᴴ * Ψ)ᵀ := by
  ext o o'
  rw [rhoO_apply, transpose_apply, Matrix.mul_apply]
  exact Finset.sum_congr rfl fun b _ ↦ by simp [Matrix.conjTranspose_apply, mul_comm]

/-- Theorem 4.1 (Schmidt): `Tr ρ_B² = Tr ρ_O²` for every pure bipartite state. -/
theorem thm_4_1_schmidt_purity [Fintype B] [Fintype O] (Ψ : Matrix B O ℂ) :
    (rhoB Ψ * rhoB Ψ).trace = (rhoO Ψ * rhoO Ψ).trace := by
  rw [rhoO_eq_transpose, ← transpose_mul, trace_transpose, rhoB, Matrix.mul_assoc,
    trace_mul_comm]
  simp only [Matrix.mul_assoc]

/-- The base reduced density matrix `rhoB Ψ` is positive semidefinite. -/
theorem rhoB_posSemidef [Fintype O] (Ψ : Matrix B O ℂ) : (rhoB Ψ).PosSemidef :=
  posSemidef_self_mul_conjTranspose Ψ

/-- The overlay reduced density matrix `rhoO Ψ` is positive semidefinite. -/
theorem rhoO_posSemidef [Fintype B] (Ψ : Matrix B O ℂ) : (rhoO Ψ).PosSemidef :=
  posSemidef_conjTranspose_mul_self _

/-- Theorem 4.1: `ρ_B` and `ρ_O` share their nonzero spectrum, so `S(ρ_B) = S(ρ_O)`. -/
theorem thm_4_1_entropy_eq [Fintype B] [Fintype O] [DecidableEq B] [DecidableEq O]
    (Ψ : Matrix B O ℂ) (h : Fintype.card O ≤ Fintype.card B) :
    vonNeumann (rhoB Ψ) (rhoB_posSemidef Ψ).isHermitian =
      vonNeumann (rhoO Ψ) (rhoO_posSemidef Ψ).isHermitian := by
  refine vonNeumann_eq_of_charpoly _ _ _ _ (Fintype.card B - Fintype.card O) ?_
  rw [rhoB, charpoly_mul_comm_of_le Ψ Ψᴴ h, rhoO_eq_transpose, charpoly_transpose]

/-- The conjugate of a unitary matrix is unitary: `R̄† R̄ = 1`. -/
theorem map_star_conjTranspose_mul [Fintype O] [DecidableEq O] (R : Matrix O O ℂ)
    (hR : Rᴴ * R = 1) : (R.map (starRingEnd ℂ))ᴴ * R.map (starRingEnd ℂ) = 1 := by
  have h := congrArg Matrix.transpose hR
  rw [transpose_mul, transpose_one] at h
  rw [← h]
  ext i j
  simp [Matrix.mul_apply, Matrix.conjTranspose_apply]

/-- Theorem 4.1 (1): local unitaries `Ψ ↦ R₁ Ψ R₂ᵀ` conjugate `ρ_O` by `R₂`. -/
theorem rhoO_local_unitary [Fintype B] [Fintype O] [DecidableEq B] (R₁ : Matrix B B ℂ)
    (R₂ : Matrix O O ℂ) (hR₁ : R₁ᴴ * R₁ = 1) (Ψ : Matrix B O ℂ) :
    rhoO (R₁ * Ψ * R₂ᵀ) = R₂ * rhoO Ψ * R₂ᴴ := by
  have hT : (R₂ᵀ).map (starRingEnd ℂ) = R₂ᴴ := by
    ext i j
    rfl
  rw [rhoO, Matrix.map_mul, Matrix.map_mul, hT, conjTranspose_mul, conjTranspose_mul,
    conjTranspose_conjTranspose]
  have hU := map_star_conjTranspose_mul R₁ hR₁
  calc R₂ * ((Ψ.map (starRingEnd ℂ))ᴴ * (R₁.map (starRingEnd ℂ))ᴴ) *
        (R₁.map (starRingEnd ℂ) * Ψ.map (starRingEnd ℂ) * R₂ᴴ)
      = R₂ * (Ψ.map (starRingEnd ℂ))ᴴ *
          ((R₁.map (starRingEnd ℂ))ᴴ * R₁.map (starRingEnd ℂ)) * Ψ.map (starRingEnd ℂ) * R₂ᴴ := by
        simp only [Matrix.mul_assoc]
    _ = R₂ * rhoO Ψ * R₂ᴴ := by
        rw [hU, Matrix.mul_one, rhoO]
        simp only [Matrix.mul_assoc]

/-- Theorem 4.1 (1): unitary conjugation preserves the characteristic polynomial (isospectrality)
and the purity. -/
theorem thm_4_1_isospectral [Fintype O] [DecidableEq O] (R : Matrix O O ℂ) (hR : Rᴴ * R = 1)
    (A : Matrix O O ℂ) :
    (R * A * Rᴴ).charpoly = A.charpoly ∧ (R * A * Rᴴ * (R * A * Rᴴ)).trace = (A * A).trace := by
  constructor
  · rw [Matrix.mul_assoc, charpoly_mul_comm, Matrix.mul_assoc, hR, Matrix.mul_one]
  · have : R * A * Rᴴ * (R * A * Rᴴ) = R * (A * A * Rᴴ) := by
      simp only [Matrix.mul_assoc]
      rw [← Matrix.mul_assoc Rᴴ R, hR, Matrix.one_mul]
    rw [this, trace_mul_comm, Matrix.mul_assoc, hR, Matrix.mul_one]

end Bipartite

section Botge

/-- `g_L` is even in `Δ`. -/
theorem gL_neg (Nb : ℕ) (u Δ : ℝ) : gL Nb u (-Δ) = gL Nb u Δ := by
  unfold gL
  by_cases h : Δ = 0
  · simp [h]
  · simp [h, mul_neg, neg_div, Real.sin_neg, div_neg]

/-- Toeplitz counting: `∑_{a,b < N} F(a - b) = N F(0) + 2 ∑_{d=1}^{N-1} (N - d) F(d)` for even
`F`. -/
theorem sum_toeplitz (F : ℝ → ℝ) (hF : ∀ x, F (-x) = F x) (N : ℕ) :
    ∑ a ∈ range N, ∑ b ∈ range N, F ((a : ℝ) - b) =
      N * F 0 + 2 * ∑ d ∈ Ico 1 N, ((N : ℝ) - d) * F d := by
  induction N with
  | zero => simp
  | succ N ih =>
    have hrefl : ∑ a ∈ range N, F ((N : ℝ) - a) = ∑ d ∈ Ico 1 (N + 1), F d := by
      rw [Finset.sum_Ico_eq_sum_range, Nat.add_sub_cancel, ← Finset.sum_range_reflect]
      refine Finset.sum_congr rfl fun a ha ↦ ?_
      have ha' : a < N := Finset.mem_range.mp ha
      congr 1
      rw [show N - 1 - a = N - (1 + a) by omega, Nat.cast_sub (by omega : 1 + a ≤ N)]
      push_cast
      ring
    have hsplit : ∑ d ∈ Ico 1 (N + 1), ((N + 1 : ℕ) - (d : ℝ)) * F d =
        ∑ d ∈ Ico 1 N, ((N : ℝ) - d) * F d + ∑ d ∈ Ico 1 (N + 1), F d := by
      rcases Nat.eq_zero_or_pos N with h0 | hpos
      · subst h0
        simp
      rw [Finset.sum_Ico_succ_top (by omega), Finset.sum_Ico_succ_top (by omega)]
      push_cast
      have : ∑ d ∈ Ico 1 N, ((N : ℝ) + 1 - d) * F d =
          ∑ d ∈ Ico 1 N, ((N : ℝ) - d) * F d + ∑ d ∈ Ico 1 N, F d := by
        rw [← Finset.sum_add_distrib]
        exact Finset.sum_congr rfl fun d _ ↦ by ring
      rw [this]
      ring
    rw [Finset.sum_range_succ, Finset.sum_range_succ]
    simp only [Finset.sum_range_succ, Finset.sum_add_distrib, ih]
    have hsym : ∑ a ∈ range N, F ((a : ℝ) - N) = ∑ a ∈ range N, F ((N : ℝ) - a) :=
      Finset.sum_congr rfl fun a _ ↦ by rw [← hF, neg_sub]
    rw [hsym, hrefl, hsplit, sub_self]
    push_cast
    ring

/-- Amplitude matrix `Ψ_L(x_b, x_o)` of the circuit output. -/
noncomputable def ampMat (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → Fin nb ⊕ Fin no → ℝ) :
    Matrix (Fin nb → Fin 2) (Fin no → Fin 2) ℂ :=
  Matrix.of fun b o ↦ psi φ J (Sum.elim b o)

/-- Amplitude matrix `Ψ_L^(0)(x_b, x_o)` of the Ising phase state before the readout layer. -/
noncomputable def ampMat0 (nb no : ℕ) (J : Fin nb ⊕ Fin no → Fin nb ⊕ Fin no → ℝ) :
    Matrix (Fin nb → Fin 2) (Fin no → Fin 2) ℂ :=
  Matrix.of fun b o ↦ isingState J (Sum.elim b o)

/-- The readout layer acts locally: `Ψ_L = R_X^{⊗n_b} Ψ_L^(0) (R_X^{⊗n_o})ᵀ`. -/
theorem ampMat_eq (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → Fin nb ⊕ Fin no → ℝ) :
    ampMat nb no φ J =
      tensor (fun _ : Fin nb ↦ rx φ) * ampMat0 nb no J * (tensor fun _ : Fin no ↦ rx φ)ᵀ := by
  ext b o
  rw [ampMat, of_apply, psi_apply,
    ← (Equiv.sumArrowEquivProdArrow (Fin nb) (Fin no) (Fin 2)).symm.sum_comp,
    Fintype.sum_prod_type, Matrix.mul_apply, Finset.sum_comm]
  refine Finset.sum_congr rfl fun o' _ ↦ ?_
  rw [Matrix.mul_apply, Finset.sum_mul]
  refine Finset.sum_congr rfl fun b' _ ↦ ?_
  simp only [Equiv.sumArrowEquivProdArrow_symm_apply_inl,
    Equiv.sumArrowEquivProdArrow_symm_apply_inr, Fintype.prod_sum_type, Sum.elim_inl,
    Sum.elim_inr, tensor_apply, transpose_apply, ampMat0, of_apply]
  have he : (Equiv.sumArrowEquivProdArrow (Fin nb) (Fin no) (Fin 2)).symm (b', o') =
      Sum.elim b' o' := rfl
  rw [he]
  ring

/-- Unitarity of the uniform `Rx(φ)` tensor layer (`Wᴴ * W = 1`). -/
theorem tensor_rx_unitary {ι : Type*} [Fintype ι] [DecidableEq ι] (φ : ℝ) :
    (tensor fun _ : ι ↦ rx φ)ᴴ * tensor (fun _ : ι ↦ rx φ) = 1 := by
  have h := tensor_mem_unitary (fun _ : ι ↦ rx φ) fun _ ↦ rx_mem_unitary φ
  rw [← Matrix.star_eq_conjTranspose]
  exact Unitary.star_mul_self_of_mem h

end Botge

section Toeplitz

/-- `V(x_b, x_o') - V(x_b, x_o) = (2 u_L / N_b) Δ (x_b - (N_b - 1)/2)` with `Δ = x_o - x_o'`. -/
theorem energy_diff_base (nb no L : ℕ) (hle : no ≤ nb) (b : Fin nb → Fin 2)
    (o o' : Fin no → Fin 2) :
    energy (coupling nb no L) (Sum.elim b o') - energy (coupling nb no L) (Sum.elim b o) =
      2 * uL L / 2 ^ nb * (((finFunctionFinEquiv o : ℕ) : ℝ) - (finFunctionFinEquiv o' : ℕ)) *
        (((finFunctionFinEquiv b : ℕ) : ℝ) - ((2 : ℝ) ^ nb - 1) / 2) := by
  have hmax : max ((2 : ℝ) ^ nb) (2 ^ no) = 2 ^ nb :=
    max_eq_left (pow_le_pow_right₀ (by norm_num) hle)
  rw [prop_3_2_coupling, prop_3_2_coupling, hmax]
  simp only [Sum.elim_comp_inl, Sum.elim_comp_inr]
  ring

/-- The `x_b`-overlap: `Ψ⁽⁰⁾(b, o) conj Ψ⁽⁰⁾(b, o') = 2^{-(n_b+n_o)} e^{i θ (x_b - (N_b-1)/2)}`. -/
theorem ampMat0_overlap (nb no L : ℕ) (hle : no ≤ nb) (b : Fin nb → Fin 2)
    (o o' : Fin no → Fin 2) :
    ampMat0 nb no (coupling nb no L) b o * star (ampMat0 nb no (coupling nb no L) b o') =
      ((2 : ℂ) ^ (nb + no))⁻¹ * exp (I *
        ((2 * uL L / 2 ^ nb * (((finFunctionFinEquiv o : ℕ) : ℝ) - (finFunctionFinEquiv o' : ℕ)) :
          ℝ) : ℂ) * (((finFunctionFinEquiv b : ℕ) : ℂ) - (((2 ^ nb : ℕ) : ℂ) - 1) / 2)) := by
  rw [ampMat0, of_apply, of_apply, mul_comm, ← starRingEnd_apply, conj_isingState_mul,
    energy_diff_base nb no L hle, Fintype.card_sum, Fintype.card_fin, Fintype.card_fin]
  congr 2
  push_cast
  ring

/-- Theorem 4.1 (1): the Toeplitz entries `ρ_O^(0)(x_o, x_o') = g_L(Δ) / N_o` (`n_o ≤ n_b`). -/
theorem thm_4_1_toeplitz (nb no L : ℕ) (hle : no ≤ nb) (hL1 : 1 ≤ L) (hL6 : L ≤ 6)
    (o o' : Fin no → Fin 2) :
    rhoO (ampMat0 nb no (coupling nb no L)) o o' =
      ((1 / 2 ^ no * gL (2 ^ nb) (uL L)
        (((finFunctionFinEquiv o : ℕ) : ℝ) - (finFunctionFinEquiv o' : ℕ)) : ℝ) : ℂ) := by
  obtain ⟨hu0, hupi, -, -⟩ := uL_bounds L hL1 hL6
  set Δ : ℝ := ((finFunctionFinEquiv o : ℕ) : ℝ) - (finFunctionFinEquiv o' : ℕ)
  set θ : ℝ := 2 * uL L / 2 ^ nb * Δ
  rw [rhoO_apply]
  simp only [ampMat0_overlap nb no L hle]
  rw [← Finset.mul_sum]
  have hsum : ∑ b : Fin nb → Fin 2, exp (I * (θ : ℂ) *
      (((finFunctionFinEquiv b : ℕ) : ℂ) - (((2 ^ nb : ℕ) : ℂ) - 1) / 2)) =
      ∑ k : Fin (2 ^ nb), exp (I * (θ : ℂ) * ((k : ℂ) - (((2 ^ nb : ℕ) : ℂ) - 1) / 2)) :=
    finFunctionFinEquiv.sum_comp (fun k : Fin (2 ^ nb) ↦
      exp (I * (θ : ℂ) * ((k : ℂ) - (((2 ^ nb : ℕ) : ℂ) - 1) / 2)))
  rw [hsum]
  have hNb : (0 : ℝ) < 2 ^ nb := by positivity
  by_cases hΔ : Δ = 0
  · have hθ : θ = 0 := by simp [θ, hΔ]
    simp only [hθ, Complex.ofReal_zero, mul_zero, zero_mul, Complex.exp_zero,
      Finset.sum_const, Finset.card_univ, Fintype.card_fin, nsmul_eq_mul, mul_one]
    simp only [gL, hΔ, ↓reduceIte]
    push_cast
    rw [pow_add]
    field_simp
  · have hΔlt : |Δ| < 2 ^ nb := by
      have h1 := (finFunctionFinEquiv o).isLt
      have h2 := (finFunctionFinEquiv o').isLt
      have hpow : (2 : ℕ) ^ no ≤ 2 ^ nb := Nat.pow_le_pow_right (by norm_num) hle
      rw [abs_lt]
      constructor <;> simp only [Δ] <;>
        [have := (Nat.cast_le (α := ℝ)).mpr (Nat.zero_le (finFunctionFinEquiv o : ℕ));
         have := (Nat.cast_le (α := ℝ)).mpr (Nat.zero_le (finFunctionFinEquiv o' : ℕ))] <;>
        · have h1' : ((finFunctionFinEquiv o : ℕ) : ℝ) < 2 ^ nb := by
            exact_mod_cast h1.trans_le hpow
          have h2' : ((finFunctionFinEquiv o' : ℕ) : ℝ) < 2 ^ nb := by
            exact_mod_cast h2.trans_le hpow
          have h0 : (0 : ℝ) ≤ (finFunctionFinEquiv o : ℕ) := Nat.cast_nonneg _
          have h0' : (0 : ℝ) ≤ (finFunctionFinEquiv o' : ℕ) := Nat.cast_nonneg _
          linarith
    have hhalf : θ / 2 = uL L * Δ / 2 ^ nb := by simp only [θ]; ring
    have hsin : Real.sin (θ / 2) ≠ 0 := by
      rw [hhalf]
      intro h0
      have hbound : |uL L * Δ / 2 ^ nb| < Real.pi := by
        rw [abs_div, abs_mul, abs_of_pos hu0, abs_of_pos hNb, div_lt_iff₀ hNb]
        calc uL L * |Δ| < uL L * 2 ^ nb := mul_lt_mul_of_pos_left hΔlt hu0
          _ ≤ Real.pi * 2 ^ nb := by nlinarith [Real.pi_pos]
      have := (Real.sin_eq_zero_iff_of_lt_of_lt (abs_lt.mp hbound).1 (abs_lt.mp hbound).2).mp h0
      rcases mul_eq_zero.mp (div_eq_zero_iff.mp this |>.resolve_right hNb.ne') with h | h
      · exact hu0.ne' h
      · exact hΔ h
    rw [thm_4_1_dirichlet_sum (2 ^ nb) θ hsin]
    simp only [gL, hΔ, ↓reduceIte]
    have hNθ : ((2 ^ nb : ℕ) : ℝ) * θ / 2 = uL L * Δ := by
      simp only [θ]
      push_cast
      field_simp
    rw [hNθ, hhalf]
    push_cast
    rw [pow_add]
    field_simp

end Toeplitz

section Main

/-- The overlay reduced state `rhoO (ampMat nb no φ J)` has trace `1`. -/
theorem trace_rhoO_ampMat (nb no : ℕ) (φ : ℝ) (J : Fin nb ⊕ Fin no → Fin nb ⊕ Fin no → ℝ) :
    (rhoO (ampMat nb no φ J)).trace = 1 := by
  have h := sum_born φ J
  rw [← (Equiv.sumArrowEquivProdArrow (Fin nb) (Fin no) (Fin 2)).symm.sum_comp,
    Fintype.sum_prod_type] at h
  simp only [Matrix.trace, Matrix.diag, rhoO_apply, ampMat, of_apply]
  rw [Finset.sum_comm]
  have h' := congrArg (fun r : ℝ ↦ (r : ℂ)) h
  simp only [Complex.ofReal_sum, Complex.ofReal_one] at h'
  rw [← h']
  refine Finset.sum_congr rfl fun b _ ↦ Finset.sum_congr rfl fun o _ ↦ ?_
  rw [born, ← starRingEnd_apply, Complex.mul_conj]
  rfl

/-- The purity of the Toeplitz reduced state `ρ_O^(0)` (`eq:purity`). -/
theorem purity_toeplitz (nb no L : ℕ) (hle : no ≤ nb) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    ((rhoO (ampMat0 nb no (coupling nb no L)) * rhoO (ampMat0 nb no (coupling nb no L))).trace).re =
      1 / (2 ^ no : ℕ) + (2 / ((2 ^ no : ℕ) : ℝ) ^ 2) *
        ∑ d ∈ Ico 1 (2 ^ no : ℕ), (((2 ^ no : ℕ) : ℝ) - (d : ℝ)) * gL (2 ^ nb) (uL L) d ^ 2 := by
  set N : ℕ := 2 ^ no
  have hN : (N : ℝ) ≠ 0 := by positivity
  have hentry : ∀ o o' : Fin no → Fin 2,
      (rhoO (ampMat0 nb no (coupling nb no L)) o o' *
        rhoO (ampMat0 nb no (coupling nb no L)) o' o).re =
      1 / (N : ℝ) ^ 2 * gL (2 ^ nb) (uL L)
        (((finFunctionFinEquiv o : ℕ) : ℝ) - (finFunctionFinEquiv o' : ℕ)) ^ 2 := by
    intro o o'
    rw [thm_4_1_toeplitz nb no L hle hL1 hL6, thm_4_1_toeplitz nb no L hle hL1 hL6,
      ← Complex.ofReal_mul, Complex.ofReal_re, ← gL_neg (2 ^ nb) (uL L), neg_sub]
    simp only [N]
    push_cast
    ring
  set G : ℕ → ℕ → ℝ := fun a b ↦ 1 / (N : ℝ) ^ 2 * gL (2 ^ nb) (uL L) ((a : ℝ) - b) ^ 2
  rw [Matrix.trace, Complex.re_sum]
  simp only [Matrix.diag, Matrix.mul_apply, Complex.re_sum, hentry]
  calc ∑ i : Fin no → Fin 2, ∑ x : Fin no → Fin 2,
        G (finFunctionFinEquiv i : ℕ) (finFunctionFinEquiv x : ℕ)
      = ∑ a : Fin N, ∑ x : Fin no → Fin 2, G a (finFunctionFinEquiv x : ℕ) :=
        Fintype.sum_equiv finFunctionFinEquiv _ _ fun _ ↦ rfl
    _ = ∑ a : Fin N, ∑ b : Fin N, G a b :=
        Finset.sum_congr rfl fun a _ ↦ Fintype.sum_equiv finFunctionFinEquiv _ _ fun _ ↦ rfl
    _ = ∑ a ∈ range N, ∑ b ∈ range N, G a b := by
        rw [Fin.sum_univ_eq_sum_range (fun a ↦ ∑ b : Fin N, G a b) N]
        exact Finset.sum_congr rfl fun a _ ↦ Fin.sum_univ_eq_sum_range (fun b ↦ G a b) N
    _ = _ := by
        simp only [G, ← Finset.mul_sum]
        rw [sum_toeplitz (fun x ↦ gL (2 ^ nb) (uL L) x ^ 2) (fun x ↦ by rw [gL_neg]) N,
          show gL (2 ^ nb) (uL L) 0 = 1 by simp [gL], one_pow]
        field_simp

/-- **Theorem 4.1** (`thm:entanglement`), for `1 ≤ n_o ≤ n_b`, where `N_min = N_o`
and `N_max = N_b`; `thm_4_1_entanglement_general` covers every ordering.
With `P = 1/N_o + (2/N_o²) ∑_{Δ=1}^{N_o-1} (N_o - Δ) g_L(Δ)²`:
`ρ_O = W ρ_O^(0) W†` (`W = R_X^{⊗n_o}`), `ρ_O` is isospectral to the Toeplitz `ρ_O^(0)`,
`Tr ρ_B² = Tr ρ_O² = P`, the two-sided bounds `eq:purity-bounds` hold, and
`0 < S₂(ρ_B) ≤ S(ρ_B) < n_o log 2 = min(n_b, n_o) log 2` (nats). -/
theorem thm_4_1_entanglement (nb no L : ℕ) (hno : 1 ≤ no) (hle : no ≤ nb) (hL1 : 1 ≤ L)
    (hL6 : L ≤ 6) :
    let Ψ := ampMat nb no (-(Real.pi / 4)) (coupling nb no L)
    let W := tensor fun _ : Fin no ↦ rx (-(Real.pi / 4))
    let No : ℝ := ((2 ^ no : ℕ) : ℝ)
    let u := uL L
    let P : ℝ := 1 / No + (2 / No ^ 2) *
      ∑ d ∈ Ico 1 (2 ^ no : ℕ), (No - (d : ℝ)) * gL (2 ^ nb) u d ^ 2
    rhoO Ψ = W * rhoO (ampMat0 nb no (coupling nb no L)) * Wᴴ ∧
      (rhoO Ψ).charpoly = (rhoO (ampMat0 nb no (coupling nb no L))).charpoly ∧
      ((rhoB Ψ * rhoB Ψ).trace).re = P ∧ ((rhoO Ψ * rhoO Ψ).trace).re = P ∧
      1 / No + (2 * (No - 1) / No ^ 2) * (Real.sin u / u) ^ 2 < P ∧
      P ≤ 1 - (2 * (No - 1) / No ^ 2) * Real.sin (u / 2) ^ 2 ∧ 1 / No < P ∧ P < 1 ∧
      0 < -Real.log P ∧
      -Real.log P ≤ vonNeumann (rhoB Ψ) (rhoB_posSemidef Ψ).isHermitian ∧
      vonNeumann (rhoB Ψ) (rhoB_posSemidef Ψ).isHermitian < no * Real.log 2 := by
  intro Ψ W No u P
  obtain ⟨hu0, hupi, -, -⟩ := uL_bounds L hL1 hL6
  set Ψ0 := ampMat0 nb no (coupling nb no L)
  have hρ : rhoO Ψ = W * rhoO Ψ0 * Wᴴ := by
    simp only [Ψ, Ψ0, W]
    rw [ampMat_eq, rhoO_local_unitary _ _ (tensor_rx_unitary _)]
  obtain ⟨hchar, htr⟩ := thm_4_1_isospectral W (tensor_rx_unitary (ι := Fin no) (-(Real.pi / 4)))
    (rhoO Ψ0)
  have hP0 := purity_toeplitz nb no L hle hL1 hL6
  have hPO : ((rhoO Ψ * rhoO Ψ).trace).re = P := by rw [hρ, htr, hP0]
  have hPB : ((rhoB Ψ * rhoB Ψ).trace).re = P := by rw [thm_4_1_schmidt_purity, hPO]
  have h2No : (2 : ℕ) ≤ 2 ^ no := by
    calc 2 = 2 ^ 1 := by norm_num
      _ ≤ 2 ^ no := Nat.pow_le_pow_right (by norm_num) hno
  obtain ⟨hlo, hup, hgt, hlt⟩ := thm_4_1_purity_bounds (2 ^ nb) (2 ^ no) h2No
    (Nat.pow_le_pow_right (by norm_num) hle) u hu0 hupi
  have hcardO : (Fintype.card (Fin no → Fin 2) : ℝ) = No := by
    simp [No]
  obtain ⟨hS2, hS2S, hSlt⟩ := vonNeumann_bounds (rhoO Ψ) (rhoO_posSemidef Ψ)
    (trace_rhoO_ampMat nb no _ _) (by rw [hcardO, hPO]; exact hgt) (by rw [hPO]; exact hlt)
  have hcardle : Fintype.card (Fin no → Fin 2) ≤ Fintype.card (Fin nb → Fin 2) := by
    simp only [Fintype.card_fun, Fintype.card_fin]
    exact Nat.pow_le_pow_right (by norm_num) hle
  have hent := thm_4_1_entropy_eq Ψ hcardle
  refine ⟨hρ, by rw [hρ, hchar], hPB, hPO, hlo, hup, hgt, hlt, by rwa [hPO] at hS2, ?_, ?_⟩
  · rw [hent, ← hPO]
    exact hS2S
  · rw [hent]
    calc vonNeumann (rhoO Ψ) _ < Real.log (Fintype.card (Fin no → Fin 2)) := hSlt
      _ = no * Real.log 2 := by
        rw [Fintype.card_fun, Fintype.card_fin, Fintype.card_fin, Nat.cast_pow, Real.log_pow]
        norm_num

/-- Theorem 4.1 (2), printed constants: for `L ∈ 1..6`, `0.659 < sin u_L / u_L` and
`g_L(1) ≤ cos(u_L / 2) ≤ cos(φ⁻¹ / 2) < 0.953`. -/
theorem thm_4_1_constants (Nb L : ℕ) (hNb : 2 ≤ Nb) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    (659 / 1000 : ℝ) < Real.sin (uL L) / uL L ∧
      gL Nb (uL L) 1 ≤ Real.cos (uL L / 2) ∧
      Real.cos (uL L / 2) ≤ Real.cos (Real.goldenRatio⁻¹ / 2) ∧
      Real.cos (Real.goldenRatio⁻¹ / 2) < 953 / 1000 := by
  obtain ⟨hu0, hupi, hu1, hu6⟩ := uL_bounds L hL1 hL6
  obtain ⟨-, hu6', -, -⟩ := uL_bounds 6 (by norm_num) le_rfl
  have hφ : Real.goldenRatio⁻¹ = uL 1 := by simp [uL]
  have hmono : uL 1 ≤ uL L := by
    unfold uL
    exact mul_le_mul_of_nonneg_left (Real.sqrt_le_sqrt (by exact_mod_cast hL1))
      (inv_pos.mpr Real.goldenRatio_pos).le
  have hmono6 : uL L ≤ uL 6 := by
    unfold uL
    exact mul_le_mul_of_nonneg_left (Real.sqrt_le_sqrt (by exact_mod_cast hL6))
      (inv_pos.mpr Real.goldenRatio_pos).le
  refine ⟨?_, (thm_4_1_g1_bounds Nb hNb (uL L) hu0 hupi).2, ?_, ?_⟩
  · -- `sin t / t` is antitone on `(0, π]` (concavity of `sin`), so its minimum is at `u_6`.
    have hanti : Real.sin (uL 6) / uL 6 ≤ Real.sin (uL L) / uL L := by
      have h6 : 0 < uL 6 := by linarith
      rcases hmono6.eq_or_lt with heq | hlt
      · rw [heq]
      have hconc := strictConcaveOn_sin_Icc.concaveOn.2
        (⟨le_rfl, Real.pi_pos.le⟩ : (0 : ℝ) ∈ Set.Icc 0 Real.pi)
        (⟨by linarith, by linarith⟩ : uL 6 ∈ Set.Icc 0 Real.pi)
        (show (0 : ℝ) ≤ 1 - uL L / uL 6 by rw [sub_nonneg, div_le_one (by linarith)]; linarith)
        (show (0 : ℝ) ≤ uL L / uL 6 by positivity) (by ring)
      simp only [smul_eq_mul, Real.sin_zero, mul_zero, zero_add] at hconc
      rw [show uL L / uL 6 * uL 6 = uL L by field_simp, div_mul_eq_mul_div,
        div_le_iff₀ h6] at hconc
      rw [div_le_div_iff₀ h6 hu0]
      linarith
    have hy0 : 0 < Real.pi / 2 - uL 6 := by linarith
    have hy1 : Real.pi / 2 - uL 6 < 57 / 1000 := by
      obtain ⟨hl, -⟩ := uL_encl_6
      norm_num at hl
      linarith [Real.pi_lt_d4]
    have hsin6 : Real.sin (uL 6) = Real.cos (Real.pi / 2 - uL 6) := by
      rw [Real.cos_pi_div_two_sub]
    have hcos := Real.one_sub_sq_div_two_le_cos (x := Real.pi / 2 - uL 6)
    have hsin_lo : (99837 / 100000 : ℝ) < Real.sin (uL 6) := by
      rw [hsin6]
      nlinarith
    calc (659 / 1000 : ℝ) < Real.sin (uL 6) / uL 6 := by
          rw [lt_div_iff₀ (by linarith)]
          nlinarith
      _ ≤ _ := hanti
  · rw [hφ]
    exact Real.cos_le_cos_of_nonneg_of_le_pi (by linarith) (by linarith [Real.pi_pos])
      (by linarith)
  · rw [hφ]
    obtain ⟨hl, hh⟩ := uL_encl_1
    norm_num at hl hh
    have hx0 : 0 < uL 1 / 2 := by linarith
    have hb := Real.cos_bound (x := uL 1 / 2) (by rw [abs_of_pos hx0]; linarith)
    rw [abs_of_pos hx0] at hb
    have hup : Real.cos (uL 1 / 2) ≤ 1 - (uL 1 / 2) ^ 2 / 2 + (uL 1 / 2) ^ 4 * (5 / 96) := by
      linarith [le_abs_self (Real.cos (uL 1 / 2) - (1 - (uL 1 / 2) ^ 2 / 2))]
    have hx2 : ((309 / 1000 : ℝ)) ^ 2 < (uL 1 / 2) ^ 2 := by nlinarith
    have hx4 : (uL 1 / 2) ^ 4 < ((31 / 100 : ℝ)) ^ 4 :=
      pow_lt_pow_left₀ (by linarith) hx0.le (by norm_num)
    linarith

end Main

section Swap

variable {ι ι' : Type*} [Fintype ι] [DecidableEq ι] [Fintype ι'] [DecidableEq ι']

/-- Exchanging the registers transposes the amplitude matrix. -/
theorem ampMat_swap (nb no L : ℕ) (φ : ℝ) :
    ampMat nb no φ (coupling nb no L) = (ampMat no nb φ (coupling no nb L))ᵀ := by
  ext b o
  have hJ : coupling no nb L =
      fun p q ↦ coupling nb no L (Equiv.sumComm _ _ p) (Equiv.sumComm _ _ q) :=
    funext fun p ↦ funext fun q ↦ coupling_swap nb no L p q
  have hy : Sum.elim o b = Sum.elim b o ∘ Equiv.sumComm (Fin no) (Fin nb) := by
    funext p
    rcases p with l | j <;> rfl
  rw [transpose_apply, ampMat, ampMat, of_apply, of_apply, hJ, hy, psi_relabel]

/-- Exchanging the registers transposes the amplitude matrix before the readout layer. -/
theorem ampMat0_swap (nb no L : ℕ) :
    ampMat0 nb no (coupling nb no L) = (ampMat0 no nb (coupling no nb L))ᵀ := by
  ext b o
  have hJ : coupling no nb L =
      fun p q ↦ coupling nb no L (Equiv.sumComm _ _ p) (Equiv.sumComm _ _ q) :=
    funext fun p ↦ funext fun q ↦ coupling_swap nb no L p q
  have hy : Sum.elim o b = Sum.elim b o ∘ Equiv.sumComm (Fin no) (Fin nb) := by
    funext p
    rcases p with l | j <;> rfl
  rw [transpose_apply, ampMat0, ampMat0, of_apply, of_apply, hJ, hy, isingState, isingState,
    Fintype.card_congr (Equiv.sumComm (Fin no) (Fin nb)), energy_relabel]

/-- The base reduced state of `Ψ` is the overlay reduced state of `Ψᵀ`. -/
theorem rhoO_transpose {B O : Type*} [Fintype O] (Ψ : Matrix B O ℂ) :
    rhoO Ψᵀ = rhoB Ψ := by
  ext b b'
  simp [rhoO_apply, rhoB, Matrix.mul_apply, Matrix.conjTranspose_apply]

/-- The overlay reduced state of `Ψ` is the base reduced state of `Ψᵀ`. -/
theorem rhoB_transpose {B O : Type*} [Fintype B] (Ψ : Matrix B O ℂ) :
    rhoB Ψᵀ = rhoO Ψ := by
  ext o o'
  simp [rhoO_apply, rhoB, Matrix.mul_apply, Matrix.conjTranspose_apply]

/-- The von Neumann entropy depends only on the matrix, not on the Hermitian proof. -/
theorem vonNeumann_congr {n : Type*} [Fintype n] [DecidableEq n] {A A' : Matrix n n ℂ}
    (h : A = A') (hA : A.IsHermitian) (hA' : A'.IsHermitian) :
    vonNeumann A hA = vonNeumann A' hA' := by
  subst h
  rfl

end Swap

section General

/-- **Theorem 4.1** (`thm:entanglement`) for all register widths `n_b, n_o ≥ 1`, as the
`.tex` states it. With `N_min = 2^{min(n_b, n_o)}`, `N_max = 2^{max(n_b, n_o)}`
and `P = 1/N_min + (2/N_min²) ∑_{Δ=1}^{N_min-1} (N_min - Δ) g_L(Δ)²` (where `g_L` uses `N_max`):
`Tr ρ_B² = Tr ρ_O² = P`, the bounds `eq:purity-bounds` hold, and
`0 < S₂(ρ_B) ≤ S(ρ_B) < min(n_b, n_o) log 2` (nats). Exchanging the registers transposes the
amplitude matrix (`ampMat_swap`), so the case `n_b < n_o` follows from `thm_4_1_entanglement`. -/
theorem thm_4_1_entanglement_general (nb no L : ℕ) (hnb : 1 ≤ nb) (hno : 1 ≤ no) (hL1 : 1 ≤ L)
    (hL6 : L ≤ 6) :
    let Ψ := ampMat nb no (-(Real.pi / 4)) (coupling nb no L)
    let Nmin : ℝ := ((2 ^ min nb no : ℕ) : ℝ)
    let u := uL L
    let P : ℝ := 1 / Nmin + (2 / Nmin ^ 2) *
      ∑ d ∈ Ico 1 (2 ^ min nb no : ℕ), (Nmin - (d : ℝ)) * gL (2 ^ max nb no) u d ^ 2
    ((rhoB Ψ * rhoB Ψ).trace).re = P ∧ ((rhoO Ψ * rhoO Ψ).trace).re = P ∧
      1 / Nmin + (2 * (Nmin - 1) / Nmin ^ 2) * (Real.sin u / u) ^ 2 < P ∧
      P ≤ 1 - (2 * (Nmin - 1) / Nmin ^ 2) * Real.sin (u / 2) ^ 2 ∧ 1 / Nmin < P ∧ P < 1 ∧
      0 < -Real.log P ∧
      -Real.log P ≤ vonNeumann (rhoB Ψ) (rhoB_posSemidef Ψ).isHermitian ∧
      vonNeumann (rhoB Ψ) (rhoB_posSemidef Ψ).isHermitian < (min nb no : ℕ) * Real.log 2 := by
  intro Ψ Nmin u P
  rcases le_total no nb with hle | hle
  · simp only [Nmin, P, min_eq_right hle, max_eq_left hle]
    obtain ⟨-, -, hPB, hPO, hlo, hup, hgt, hlt, hpos, hS2, hS⟩ :=
      thm_4_1_entanglement nb no L hno hle hL1 hL6
    exact ⟨hPB, hPO, hlo, hup, hgt, hlt, hpos, hS2, hS⟩
  · simp only [Nmin, P, min_eq_left hle, max_eq_right hle]
    obtain ⟨-, -, hPB, hPO, hlo, hup, hgt, hlt, hpos, hS2, hS⟩ :=
      thm_4_1_entanglement no nb L hnb hle hL1 hL6
    set Ψ' := ampMat no nb (-(Real.pi / 4)) (coupling no nb L)
    have hΨ : Ψ = Ψ'ᵀ := ampMat_swap nb no L _
    have hB : rhoB Ψ = rhoO Ψ' := by rw [hΨ, rhoB_transpose]
    have hO : rhoO Ψ = rhoB Ψ' := by rw [hΨ, rhoO_transpose]
    have hcard : Fintype.card (Fin nb → Fin 2) ≤ Fintype.card (Fin no → Fin 2) := by
      simp only [Fintype.card_fun, Fintype.card_fin]
      exact Nat.pow_le_pow_right (by norm_num) hle
    have hS' : vonNeumann (rhoB Ψ) (rhoB_posSemidef Ψ).isHermitian =
        vonNeumann (rhoB Ψ') (rhoB_posSemidef Ψ').isHermitian :=
      (vonNeumann_congr hB _ (rhoO_posSemidef Ψ').isHermitian).trans
        (thm_4_1_entropy_eq Ψ' hcard).symm
    refine ⟨by rw [hB]; exact hPO, by rw [hO]; exact hPB, hlo, hup, hgt, hlt, hpos, ?_, ?_⟩
    · rw [hS']
      exact hS2
    · rw [hS']
      exact hS

/-- Theorem 4.1 (1) for the base register when `1 ≤ n_b ≤ n_o`, so `N_min = N_b`:
`ρ_B = W ρ_B^(0) W†` (`W = R_X^{⊗n_b}`), `ρ_B` is isospectral to the Toeplitz `ρ_B^(0)`, whose
entries are `ρ_B^(0)(x_b, x_b') = g_L(x_b - x_b') / N_b` with `g_L` built from `N_max = N_o`. -/
theorem thm_4_1_toeplitz_base (nb no L : ℕ) (hnb : 1 ≤ nb) (hle : nb ≤ no) (hL1 : 1 ≤ L)
    (hL6 : L ≤ 6) :
    let W := tensor fun _ : Fin nb ↦ rx (-(Real.pi / 4))
    rhoB (ampMat nb no (-(Real.pi / 4)) (coupling nb no L)) =
        W * rhoB (ampMat0 nb no (coupling nb no L)) * Wᴴ ∧
      (rhoB (ampMat nb no (-(Real.pi / 4)) (coupling nb no L))).charpoly =
        (rhoB (ampMat0 nb no (coupling nb no L))).charpoly ∧
      ∀ b b' : Fin nb → Fin 2, rhoB (ampMat0 nb no (coupling nb no L)) b b' =
        ((1 / 2 ^ nb * gL (2 ^ no) (uL L)
          (((finFunctionFinEquiv b : ℕ) : ℝ) - (finFunctionFinEquiv b' : ℕ)) : ℝ) : ℂ) := by
  have hΨ : rhoB (ampMat nb no (-(Real.pi / 4)) (coupling nb no L)) =
      rhoO (ampMat no nb (-(Real.pi / 4)) (coupling no nb L)) := by
    rw [ampMat_swap, rhoB_transpose]
  have hΨ0 : rhoB (ampMat0 nb no (coupling nb no L)) =
      rhoO (ampMat0 no nb (coupling no nb L)) := by
    rw [ampMat0_swap, rhoB_transpose]
  refine ⟨?_, ?_, fun b b' ↦ ?_⟩
  · rw [hΨ, hΨ0]
    exact (thm_4_1_entanglement no nb L hnb hle hL1 hL6).1
  · rw [hΨ, hΨ0]
    exact (thm_4_1_entanglement no nb L hnb hle hL1 hL6).2.1
  · rw [hΨ0]
    exact thm_4_1_toeplitz no nb L hle hL1 hL6 b b'

end General

end

end BotgeLean
