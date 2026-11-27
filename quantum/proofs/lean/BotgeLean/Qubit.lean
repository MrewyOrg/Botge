/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import Mathlib.Analysis.SpecialFunctions.Trigonometric.Basic
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Qubit registers, spins, and single-qubit gates

Computational basis states of a register whose qubits are indexed by a finite type `ι` are
functions `ι → Fin 2`. This file defines the Pauli-`Z` spin `s(0) = 1`, `s(1) = -1`, bit
complements, the little-endian value of a register, the single-qubit gates used by Botge's
circuit, and register-wide tensor products of single-qubit matrices.

The main tool is `sum_prod_bits`: a sum over all basis states of a product of single-qubit factors
factorizes into a product of two-term sums. Every expectation in the correlation proofs reduces to
it.
-/

open Complex Matrix

namespace BotgeLean

@[expose] public section

/-- Pauli-`Z` eigenvalue of a basis bit: `+1` on `0` and `-1` on `1`. -/
def spin (a : Fin 2) : ℝ := if a = 0 then 1 else -1

/-- Spin of `0` is `+1`. -/
@[simp] theorem spin_zero : spin 0 = 1 := rfl

/-- Spin of `1` is `-1`. -/
@[simp] theorem spin_one : spin 1 = -1 := rfl

/-- Complementing a bit (`Fin.rev`, the action of Pauli `X`) negates its spin. -/
theorem spin_rev (a : Fin 2) : spin a.rev = -spin a := by
  fin_cases a <;> norm_num [spin, Fin.rev, Fin.ext_iff]

/-- Spins square to `1`. -/
theorem spin_mul_self (a : Fin 2) : spin a * spin a = 1 := by
  fin_cases a <;> norm_num [spin]

/-- Linear form `spin a = 1 - 2a`. -/
theorem spin_eq_one_sub (a : Fin 2) : spin a = 1 - 2 * (a : ℝ) := by
  fin_cases a <;> norm_num [spin]

/-- Bitwise complement `X^{⊗ ι}` of register basis states, reusing Mathlib's `Fin.revPerm`. -/
def complEquiv (ι : Type*) : (ι → Fin 2) ≃ (ι → Fin 2) :=
  Equiv.piCongrRight fun _ ↦ Fin.revPerm

/-- Pointwise action of `complEquiv`. -/
@[simp] theorem complEquiv_apply {ι : Type*} (x : ι → Fin 2) (q : ι) :
    complEquiv ι x q = (x q).rev := rfl

/-- Complementing every bit maps the little-endian value `x` (Mathlib's `finFunctionFinEquiv`) to
`2^n - 1 - x`. -/
theorem finFunctionFinEquiv_compl {n : ℕ} (x : Fin n → Fin 2) :
    (finFunctionFinEquiv (complEquiv _ x) : ℕ) = 2 ^ n - 1 - finFunctionFinEquiv x := by
  have hgeom : ∑ q : Fin n, 2 ^ (q : ℕ) = 2 ^ n - 1 := by
    rw [Fin.sum_univ_eq_sum_range (fun q ↦ 2 ^ q), Nat.geomSum_eq le_rfl]
    simp
  have hsum : (finFunctionFinEquiv (complEquiv _ x) : ℕ) + finFunctionFinEquiv x = 2 ^ n - 1 := by
    rw [← hgeom, finFunctionFinEquiv_apply, finFunctionFinEquiv_apply, ← Finset.sum_add_distrib]
    refine Finset.sum_congr rfl fun q _ ↦ ?_
    rcases Fin.exists_fin_two.mp ⟨x q, rfl⟩ with h | h <;> simp [h]
  omega

/-- For an `(m + 1)`-qubit register, the value lies in the lower half iff the top bit is `0`. -/
theorem finFunctionFinEquiv_lt_half_iff {m : ℕ} (x : Fin (m + 1) → Fin 2) :
    (finFunctionFinEquiv x : ℕ) < 2 ^ m ↔ x (Fin.last m) = 0 := by
  have hsplit : (finFunctionFinEquiv x : ℕ) =
      finFunctionFinEquiv (fun q : Fin m ↦ x q.castSucc) + (x (Fin.last m) : ℕ) * 2 ^ m := by
    rw [finFunctionFinEquiv_apply, finFunctionFinEquiv_apply, Fin.sum_univ_castSucc]
    simp
  have hlow := (finFunctionFinEquiv (fun q : Fin m ↦ x q.castSucc)).isLt
  rw [hsplit]
  rcases Fin.exists_fin_two.mp ⟨x (Fin.last m), rfl⟩ with h | h <;> rw [h]
  · simpa using hlow
  · simp only [Fin.val_one, one_mul, Fin.one_eq_zero_iff, OfNat.ofNat_ne_one, iff_false,
      not_lt]
    exact Nat.le_add_left _ _

/-- `2 × 2` complex matrices acting on one qubit. -/
abbrev Mat2 := Matrix (Fin 2) (Fin 2) ℂ

/-- Pauli `X`. -/
def pauliX : Mat2 := !![0, 1; 1, 0]

/-- Pauli `Y`. -/
def pauliY : Mat2 := !![0, -I; I, 0]

/-- Pauli `Z`. -/
def pauliZ : Mat2 := !![1, 0; 0, -1]

/-- Pauli `Z` is diagonal with entries `spin a` (`+1` on `0`, `-1` on `1`). -/
theorem pauliZ_eq_diagonal : pauliZ = Matrix.diagonal fun a ↦ (spin a : ℂ) := by
  ext i j
  fin_cases i <;> fin_cases j <;> simp [pauliZ, spin]

/-- Hadamard gate `H = (X + Z) / √2`. -/
noncomputable def hadamard : Mat2 := ((Real.sqrt 2)⁻¹ : ℂ) • !![1, 1; 1, -1]

/-- Adjoint `T† = diag(1, e^{-iπ/4})` of the `T` gate. -/
noncomputable def tDagger : Mat2 := !![1, 0; 0, exp (-(↑(Real.pi / 4) * I))]

/-- `Rx(φ) = exp(-i φ X / 2) = cos(φ/2) I - i sin(φ/2) X`. -/
noncomputable def rx (φ : ℝ) : Mat2 :=
  !![(Real.cos (φ / 2) : ℂ), -(I * Real.sin (φ / 2)); -(I * Real.sin (φ / 2)),
    (Real.cos (φ / 2) : ℂ)]

/-- Register-wide tensor product `⊗_q A_q` of single-qubit matrices. -/
def tensor {ι : Type*} [Fintype ι] (A : ι → Mat2) : Matrix (ι → Fin 2) (ι → Fin 2) ℂ :=
  Matrix.of fun x y ↦ ∏ q, A q (x q) (y q)

/-- Entrywise formula for `tensor A`. -/
theorem tensor_apply {ι : Type*} [Fintype ι] (A : ι → Mat2) (x y : ι → Fin 2) :
    tensor A x y = ∏ q, A q (x q) (y q) := rfl

/-- `X^{⊗ ι}` permutes computational-basis amplitudes by `complEquiv ι`. -/
theorem tensor_pauliX_mulVec {ι : Type*} [Fintype ι] [DecidableEq ι] (v : (ι → Fin 2) → ℂ) :
    (tensor fun _ : ι ↦ pauliX) *ᵥ v = fun y ↦ v (complEquiv ι y) := by
  funext y
  have hpauli : ∀ a b : Fin 2, pauliX a b = if b = a.rev then 1 else 0 := by
    intro a b
    fin_cases a <;> fin_cases b <;> simp [pauliX, Fin.rev]
  have hprod : ∀ x : ι → Fin 2, (∏ q, pauliX (y q) (x q)) =
      if x = complEquiv ι y then 1 else 0 := by
    intro x
    simp only [hpauli, Finset.prod_boole]
    congr 1
    apply propext
    constructor
    · intro h
      funext q
      exact h q (Finset.mem_univ q)
    · intro h q _
      rw [h, complEquiv_apply]
  simp only [Matrix.mulVec, dotProduct, tensor_apply, hprod, ite_mul, one_mul, zero_mul,
    Finset.sum_ite_eq', Finset.mem_univ, ite_true]

/-- Multiplication distributes over `tensor`. -/
theorem tensor_mul {ι : Type*} [Fintype ι] [DecidableEq ι] (A B : ι → Mat2) :
    tensor A * tensor B = tensor fun q ↦ A q * B q := by
  ext x y
  simp only [tensor_apply, Matrix.mul_apply, Fin.sum_univ_two, ← Finset.prod_mul_distrib]
  exact (Fintype.prod_sum fun q a ↦ A q (x q) a * B q a (y q)).symm.trans
    (by simp [Fin.sum_univ_two])

/-- The tensor product of identity matrices is the identity matrix. -/
theorem tensor_one {ι : Type*} [Fintype ι] :
    tensor (fun _ : ι ↦ (1 : Mat2)) = 1 := by
  classical
  ext x y
  simp only [tensor_apply, Matrix.one_apply]
  by_cases h : x = y
  · simp [h]
  · obtain ⟨q, hq⟩ := Function.ne_iff.mp h
    simp only [h, ite_false]
    exact Finset.prod_eq_zero (Finset.mem_univ q) (by simp [hq])

/-- Conjugate transpose distributes over `tensor`. -/
theorem conjTranspose_tensor {ι : Type*} [Fintype ι] (A : ι → Mat2) :
    (tensor A)ᴴ = tensor fun q ↦ (A q)ᴴ := by
  ext x y
  simp [tensor_apply, Matrix.conjTranspose_apply, star_prod]

/-- A tensor product of unitary single-qubit gates is unitary. -/
theorem tensor_mem_unitary {ι : Type*} [Fintype ι] [DecidableEq ι] (A : ι → Mat2)
    (hA : ∀ q, A q ∈ unitary Mat2) : tensor A ∈ unitary (Matrix (ι → Fin 2) (ι → Fin 2) ℂ) := by
  rw [Unitary.mem_iff]
  refine ⟨?_, ?_⟩
  · rw [Matrix.star_eq_conjTranspose, conjTranspose_tensor, tensor_mul]
    simp_rw [← Matrix.star_eq_conjTranspose, Unitary.star_mul_self_of_mem (hA _), tensor_one]
  · rw [Matrix.star_eq_conjTranspose, conjTranspose_tensor, tensor_mul]
    simp_rw [← Matrix.star_eq_conjTranspose, Unitary.mul_star_self_of_mem (hA _), tensor_one]

private theorem rotation_mem_unitary (c s : ℝ) (h : c ^ 2 + s ^ 2 = 1) :
    (!![(c : ℂ), -(I * s); -(I * s), (c : ℂ)] : Mat2) ∈ unitary Mat2 := by
  have hC : (c : ℂ) ^ 2 + (s : ℂ) ^ 2 = 1 := by exact_mod_cast h
  rw [Unitary.mem_iff, Matrix.star_eq_conjTranspose]
  constructor <;> ext i j <;> fin_cases i <;> fin_cases j <;>
    simp [Matrix.mul_apply, Fin.sum_univ_two, Matrix.conjTranspose_apply, Complex.conj_ofReal] <;>
    ring_nf <;> simp only [Complex.I_sq] <;> linear_combination hC

/-- `Rx(φ)` is unitary for every real angle `φ`. -/
theorem rx_mem_unitary (φ : ℝ) : rx φ ∈ unitary Mat2 :=
  rotation_mem_unitary _ _ (Real.cos_sq_add_sin_sq (φ / 2))

/-- The Hadamard gate `H` is unitary. -/
theorem hadamard_mem_unitary : hadamard ∈ unitary Mat2 := by
  have hinv : ((Real.sqrt 2 : ℝ) : ℂ)⁻¹ ^ 2 = 2⁻¹ := by
    rw [inv_pow, ← Complex.ofReal_pow, Real.sq_sqrt (by norm_num)]
    norm_num
  rw [Unitary.mem_iff, Matrix.star_eq_conjTranspose]
  constructor <;> ext i j <;> fin_cases i <;> fin_cases j <;>
    simp [hadamard, Matrix.mul_apply, Fin.sum_univ_two, Matrix.conjTranspose_apply,
      Complex.conj_ofReal] <;> ring_nf <;> rw [hinv] <;> norm_num

/-- Lemma 4.2 (2) (`eq:heis-rx`): `Rx(α)† Z Rx(α) = cos α Z + sin α Y`. -/
theorem lem_4_2_heis_rx (α : ℝ) :
    (rx α)ᴴ * pauliZ * rx α = (Real.cos α : ℂ) • pauliZ + (Real.sin α : ℂ) • pauliY := by
  have hc : Real.cos α = Real.cos (α / 2) ^ 2 - Real.sin (α / 2) ^ 2 := by
    rw [← Real.cos_two_mul', show 2 * (α / 2) = α by ring]
  have hs : Real.sin α = 2 * Real.sin (α / 2) * Real.cos (α / 2) := by
    rw [← Real.sin_two_mul, show 2 * (α / 2) = α by ring]
  set c : ℂ := (Real.cos (α / 2) : ℂ)
  set s : ℂ := (Real.sin (α / 2) : ℂ)
  have hc' : (Real.cos α : ℂ) = c ^ 2 - s ^ 2 := by
    rw [hc, Complex.ofReal_sub, Complex.ofReal_pow, Complex.ofReal_pow]
  have hs' : (Real.sin α : ℂ) = 2 * s * c := by
    rw [hs, Complex.ofReal_mul, Complex.ofReal_mul, Complex.ofReal_ofNat]
  have hcc : (starRingEnd ℂ) c = c := Complex.conj_ofReal _
  have hcs : (starRingEnd ℂ) s = s := Complex.conj_ofReal _
  rw [show rx α = !![c, -(I * s); -(I * s), c] from rfl]
  ext i j
  fin_cases i <;> fin_cases j <;>
    simp [pauliZ, pauliY, Matrix.mul_apply, Fin.sum_univ_two, Matrix.conjTranspose_apply,
      hcc, hcs, hc', hs']
  · ring_nf
    rw [Complex.I_sq]
    ring
  · ring
  · ring
  · ring_nf
    rw [Complex.I_sq]
    ring

/-- Lemma 4.2 (2) (`eq:heis-rx`): `R_X† Z R_X = (Z - Y) / √2` for `R_X = Rx(-π/4)`. -/
theorem lem_4_2_heis_rx_quarter :
    (rx (-(Real.pi / 4)))ᴴ * pauliZ * rx (-(Real.pi / 4)) =
      ((Real.sqrt 2)⁻¹ : ℂ) • (pauliZ - pauliY) := by
  have hsq : Real.sqrt 2 / 2 = (Real.sqrt 2)⁻¹ := by
    have h2 : Real.sqrt 2 ^ 2 = 2 := Real.sq_sqrt (by norm_num)
    have hne : Real.sqrt 2 ≠ 0 := by positivity
    field_simp
    linarith
  rw [lem_4_2_heis_rx, Real.cos_neg, Real.sin_neg, Real.cos_pi_div_four, Real.sin_pi_div_four,
    hsq, Complex.ofReal_neg, Complex.ofReal_inv, neg_smul, ← sub_eq_add_neg, smul_sub]

end

end BotgeLean
