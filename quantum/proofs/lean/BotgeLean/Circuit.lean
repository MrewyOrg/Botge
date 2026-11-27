/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.Qubit
public import Mathlib.NumberTheory.Real.GoldenRatio
import Mathlib.Algebra.BigOperators.Field
import Mathlib.Algebra.Order.Ring.Star
import Mathlib.Algebra.Order.Star.Int
import Mathlib.Algebra.Order.Star.Real
import Mathlib.Analysis.Real.Pi.Bounds
import Mathlib.LinearAlgebra.UnitaryGroup
import Mathlib.Tactic.Monotonicity.Lemmas
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# The bipartite Ising-`Rx` circuit (Definition 3.1 and Proposition 3.2)

The circuit acts on the qubits `Fin n_b ⊕ Fin n_o`: a Hadamard layer, the diagonal position
coupling `e^{-i V_L}`, and a uniform `Rx(φ)` readout layer (`φ = -π/4` in Botge). This file
defines the general Ising phase state for any symmetric coupling, specializes it to Botge's
couplings `θ_{bo,j,l}`, and proves Proposition 3.2 (`prop:compile`):

* the centered position expansion (`eq:pauli-x`) and the coupling factorization (`eq:rzz-pos`);
* `e^{-i V_L}` is exactly a product of pairwise-commuting `Rzz` gates, in any order, with zero
  global phase;
* the circuit is unitary, so the Born law sums to one;
* `Rx(-π/4) = e^{iπ/8} H T† H` (`eq:rx-gate`), `θ_{bo,j,l} < 0`, and the gate count is at most 96.
-/

open Complex Matrix Finset

namespace BotgeLean

@[expose] public section

section Ising

variable {ι : Type*} [Fintype ι] [DecidableEq ι]

/-- Ising energy `V(x) = ¼ ∑_{p,q} J_{pq} s_p s_q` of a basis state for a coupling matrix `J`. -/
noncomputable def energy (J : ι → ι → ℝ) (x : ι → Fin 2) : ℝ :=
  (1 / 4) * ∑ p, ∑ q, J p q * spin (x p) * spin (x q)

/-- The diagonal entangling unitary `e^{-i V}`. -/
noncomputable def isingDiag (J : ι → ι → ℝ) : Matrix (ι → Fin 2) (ι → Fin 2) ℂ :=
  diagonal fun x ↦ exp (-(energy J x : ℂ) * I)

/-- The uniform Hadamard layer `H^{⊗ ι}`. -/
noncomputable def hLayer (ι : Type*) [Fintype ι] : Matrix (ι → Fin 2) (ι → Fin 2) ℂ :=
  tensor fun _ : ι ↦ hadamard

/-- The uniform readout layer `Rx(φ)^{⊗ ι}`. -/
noncomputable def rxLayer (ι : Type*) [Fintype ι] (φ : ℝ) : Matrix (ι → Fin 2) (ι → Fin 2) ℂ :=
  tensor fun _ : ι ↦ rx φ

/-- The circuit unitary `U = Rx(φ)^{⊗ ι} e^{-i V} H^{⊗ ι}` (`eq:ising-rx-unitary`). -/
noncomputable def circuit (φ : ℝ) (J : ι → ι → ℝ) : Matrix (ι → Fin 2) (ι → Fin 2) ℂ :=
  rxLayer ι φ * isingDiag J * hLayer ι

/-- The output state `U |0…0⟩` (`eq:ising-rx-state`). -/
noncomputable def psi (φ : ℝ) (J : ι → ι → ℝ) : (ι → Fin 2) → ℂ :=
  circuit φ J *ᵥ Pi.single 0 1

/-- The Ising phase state `e^{-i V} |+…+⟩` before the readout layer. -/
noncomputable def isingState (J : ι → ι → ℝ) (x : ι → Fin 2) : ℂ :=
  ((Real.sqrt 2 : ℂ)⁻¹) ^ Fintype.card ι * exp (-(energy J x : ℂ) * I)

/-- Born probability `P(y) = |⟨y|ψ⟩|²` of a computational-basis outcome. -/
noncomputable def born (φ : ℝ) (J : ι → ι → ℝ) (y : ι → Fin 2) : ℝ := normSq (psi φ J y)

/-- First column of the Hadamard gate has entries `1 / √2`. -/
theorem hadamard_apply_zero (a : Fin 2) : hadamard a 0 = (Real.sqrt 2 : ℂ)⁻¹ := by
  fin_cases a <;> simp [hadamard]

/-- `H^{⊗ ι}` maps `|0…0⟩` to the uniform superposition `|+…+⟩`. -/
theorem hLayer_mulVec_zero : hLayer ι *ᵥ Pi.single 0 1 = fun _ ↦ ((Real.sqrt 2 : ℂ)⁻¹) ^
    Fintype.card ι := by
  funext x
  rw [mulVec_single_one]
  simp only [hLayer, col_apply, tensor_apply, Pi.zero_apply, hadamard_apply_zero,
    Finset.prod_const, Finset.card_univ]

/-- Closed form of the output amplitude: the readout layer applied to the Ising phase state. -/
theorem psi_apply (φ : ℝ) (J : ι → ι → ℝ) (y : ι → Fin 2) :
    psi φ J y = ∑ x, (∏ q, rx φ (y q) (x q)) * isingState J x := by
  rw [psi, circuit, ← mulVec_mulVec, ← mulVec_mulVec, hLayer_mulVec_zero]
  simp only [rxLayer, isingDiag, mulVec, dotProduct, tensor_apply, isingState]
  refine Finset.sum_congr rfl fun x _ ↦ ?_
  simp only [diagonal_apply, ite_mul, zero_mul, Finset.sum_ite_eq, Finset.mem_univ, ite_true]
  ring

/-- The Ising-`Rx` circuit unitary belongs to the unitary group. -/
theorem circuit_mem_unitary (φ : ℝ) (J : ι → ι → ℝ) :
    circuit φ J ∈ unitary (Matrix (ι → Fin 2) (ι → Fin 2) ℂ) := by
  refine Submonoid.mul_mem _ (Submonoid.mul_mem _ ?_ ?_) ?_
  · exact tensor_mem_unitary _ fun _ ↦ rx_mem_unitary φ
  · rw [isingDiag, diagonal_mem_unitary, Unitary.mem_iff]
    constructor <;> funext x <;>
      simp [← exp_conj, ← exp_add, Complex.conj_ofReal, map_neg, conj_I]
  · exact tensor_mem_unitary _ fun _ ↦ hadamard_mem_unitary

/-- The circuit is unitary, so the Born probabilities sum to one (`‖ψ_L‖² = 1`). -/
theorem sum_born (φ : ℝ) (J : ι → ι → ℝ) : ∑ y, born φ J y = 1 := by
  have hU := circuit_mem_unitary φ J
  have hnorm : star (psi φ J) ⬝ᵥ psi φ J = 1 := by
    rw [psi, star_mulVec, dotProduct_mulVec, vecMul_vecMul, ← star_eq_conjTranspose,
      Unitary.star_mul_self_of_mem hU, vecMul_one]
    simp [dotProduct, Pi.single_apply]
  have hre := congrArg Complex.re hnorm
  simpa [born, dotProduct, Complex.normSq_apply, Complex.mul_re, mul_comm] using hre

end Ising

section Botge

/-- Depth-scaled coupling `u_L = φ⁻¹ √L` with Mathlib's golden ratio `φ`. -/
noncomputable def uL (L : ℕ) : ℝ := Real.goldenRatio⁻¹ * Real.sqrt L

/-- Explicit radical form `φ⁻¹ = (√5 - 1) / 2`. -/
theorem goldenRatio_inv_eq : Real.goldenRatio⁻¹ = (Real.sqrt 5 - 1) / 2 := by
  rw [Real.inv_goldenRatio]
  ring

/-- Bipartite position-coupling angle `θ_{bo,j,l} = -u_L 2^j 2^l / max(N_b, N_o)`. -/
noncomputable def theta (nb no L : ℕ) (j : Fin nb) (l : Fin no) : ℝ :=
  -(uL L * 2 ^ (j : ℕ) * 2 ^ (l : ℕ) / 2 ^ max nb no)

/-- Botge's coupling matrix on `Fin n_b ⊕ Fin n_o`: `θ_{bo,j,l}` across registers, `0` within. -/
noncomputable def coupling (nb no L : ℕ) : Fin nb ⊕ Fin no → Fin nb ⊕ Fin no → ℝ
  | .inl j, .inr l => theta nb no L j l
  | .inr l, .inl j => theta nb no L j l
  | _, _ => 0

/-- Botge's coupling matrix is symmetric. -/
theorem coupling_symm (nb no L : ℕ) (p q : Fin nb ⊕ Fin no) :
    coupling nb no L p q = coupling nb no L q p := by
  rcases p with j | l <;> rcases q with j' | l' <;> rfl

/-- Botge's coupling matrix has zero diagonal. -/
@[simp] theorem coupling_self (nb no L : ℕ) (p : Fin nb ⊕ Fin no) : coupling nb no L p p = 0 := by
  rcases p with j | l <;> rfl

/-- `max(N_b, N_o) = 2 ^ max(n_b, n_o)`. -/
theorem max_two_pow (nb no : ℕ) : max ((2 : ℝ) ^ nb) (2 ^ no) = 2 ^ max nb no :=
  (Monotone.map_max (pow_right_mono₀ (by norm_num : (1 : ℝ) ≤ 2))).symm

/-- The coupling energy is `V_L = ½ ∑_{j,l} θ_{bo,j,l} Z_{b,j} Z_{o,l}`. -/
theorem energy_coupling (nb no L : ℕ) (x : Fin nb ⊕ Fin no → Fin 2) :
    energy (coupling nb no L) x =
      (1 / 2) * ∑ j, ∑ l, theta nb no L j l * spin (x (.inl j)) * spin (x (.inr l)) := by
  simp only [energy, Fintype.sum_sum_type, coupling, zero_mul, Finset.sum_const_zero, add_zero,
    zero_add]
  rw [Finset.sum_comm (f := fun l j ↦ theta nb no L j l * spin (x (.inr l)) * spin (x (.inl j)))]
  have : ∀ j l, theta nb no L j l * spin (x (.inr l)) * spin (x (.inl j)) =
      theta nb no L j l * spin (x (.inl j)) * spin (x (.inr l)) := fun _ _ ↦ by ring
  simp only [this]
  ring

private theorem sum_two_pow_real : ∀ n : ℕ, ∑ j : Fin n, (2 : ℝ) ^ (j : ℕ) = (2 : ℝ) ^ n - 1
  | 0 => by simp
  | n + 1 => by
      rw [Fin.sum_univ_castSucc]
      simp only [Fin.val_castSucc, Fin.val_last]
      rw [sum_two_pow_real n, pow_succ]
      ring

/-- Proposition 3.2 (`eq:pauli-x`): the centered position `x - (N - 1)/2` of an `n`-qubit basis
state equals `-½ ∑_j 2^j Z_j`. -/
theorem prop_3_2_pauli_x {n : ℕ} (x : Fin n → Fin 2) :
    ((finFunctionFinEquiv x : ℕ) : ℝ) - ((2 : ℝ) ^ n - 1) / 2 =
      -(1 / 2 : ℝ) * ∑ j : Fin n, (2 : ℝ) ^ (j : ℕ) * spin (x j) := by
  rw [← sum_two_pow_real n, finFunctionFinEquiv_apply]
  push_cast
  rw [Finset.mul_sum, Finset.sum_div, ← Finset.sum_sub_distrib]
  refine Finset.sum_congr rfl fun j _ ↦ ?_
  rw [spin_eq_one_sub]
  ring

/-- Proposition 3.2 (`eq:pos-ham`, `eq:rzz-pos`): `V_L = -(2 u_L / max(N_b, N_o)) x̃_b x̃_o`, the
product of the centered positions. -/
theorem prop_3_2_coupling (nb no L : ℕ) (x : Fin nb ⊕ Fin no → Fin 2) :
    energy (coupling nb no L) x =
      -(2 * uL L / max ((2 : ℝ) ^ nb) (2 ^ no)) *
        (((finFunctionFinEquiv (x ∘ .inl) : ℕ) : ℝ) - ((2 : ℝ) ^ nb - 1) / 2) *
        (((finFunctionFinEquiv (x ∘ .inr) : ℕ) : ℝ) - ((2 : ℝ) ^ no - 1) / 2) := by
  rw [prop_3_2_pauli_x, prop_3_2_pauli_x, energy_coupling, max_two_pow]
  simp only [Function.comp_apply, theta, Finset.mul_sum, Finset.sum_mul]
  conv_rhs => rw [Finset.sum_comm]
  refine Finset.sum_congr rfl fun j _ ↦ Finset.sum_congr rfl fun l _ ↦ ?_
  ring

/-- Proposition 3.2 (`eq:rzz-pos`): every coupling angle is strictly negative. -/
theorem prop_3_2_theta_neg (nb no L : ℕ) (hL : 1 ≤ L) (j : Fin nb) (l : Fin no) :
    theta nb no L j l < 0 := by
  have hphi : 0 < Real.goldenRatio⁻¹ := inv_pos.mpr Real.goldenRatio_pos
  have hsqrt : 0 < Real.sqrt L := Real.sqrt_pos.mpr (by exact_mod_cast hL)
  have : 0 < uL L * 2 ^ (j : ℕ) * 2 ^ (l : ℕ) / 2 ^ max nb no := by
    unfold uL
    positivity
  simpa [theta] using this

/-- The `Rzz_{b_j, o_l}(θ) = exp(-i θ Z_{b,j} Z_{o,l} / 2)` gate as a diagonal matrix. -/
noncomputable def rzz (nb no L : ℕ) (p : Fin nb × Fin no) :
    Matrix (Fin nb ⊕ Fin no → Fin 2) (Fin nb ⊕ Fin no → Fin 2) ℂ :=
  diagonal fun x ↦
    exp (-((theta nb no L p.1 p.2 / 2 * spin (x (.inl p.1)) * spin (x (.inr p.2)) : ℝ) : ℂ) * I)

/-- Proposition 3.2: the `Rzz` gates pairwise commute. -/
theorem prop_3_2_rzz_commute (nb no L : ℕ) (p q : Fin nb × Fin no) :
    Commute (rzz nb no L p) (rzz nb no L q) := by
  simp only [rzz, Commute, SemiconjBy, diagonal_mul_diagonal, mul_comm]

/-- Proposition 3.2 (`prop:compile`): in any order, the product of the `n_b n_o` `Rzz` gates is
exactly `e^{-i V_L}`, with zero global phase. -/
theorem prop_3_2_rzz_factorization (nb no L : ℕ) (gates : List (Fin nb × Fin no))
    (hperm : gates.Perm Finset.univ.toList) :
    (gates.map (rzz nb no L)).prod = isingDiag (coupling nb no L) := by
  let f : Fin nb × Fin no → (Fin nb ⊕ Fin no → Fin 2) → ℂ := fun p x ↦
    exp (-((theta nb no L p.1 p.2 / 2 * spin (x (.inl p.1)) * spin (x (.inr p.2)) : ℝ) : ℂ) * I)
  have hmap : gates.map (rzz nb no L) = (gates.map f).map (diagonalRingHom _ ℂ) := by
    simp [List.map_map, rzz, f, Function.comp_def]
  rw [hmap, ← map_list_prod, (hperm.map f).prod_eq, Finset.prod_map_toList, isingDiag]
  change diagonal _ = diagonal _
  congr 1
  funext x
  rw [Finset.prod_apply, energy_coupling, Fintype.prod_prod_type]
  simp only [← exp_sum]
  congr 1
  push_cast
  simp only [neg_mul, Finset.sum_neg_distrib, Finset.sum_mul, Finset.mul_sum, neg_inj]
  refine Finset.sum_congr rfl fun j _ ↦ Finset.sum_congr rfl fun l _ ↦ ?_
  ring

private theorem rotation_eq (α : ℝ) :
    (!![(Real.cos α : ℂ), I * Real.sin α; I * Real.sin α, (Real.cos α : ℂ)] : Mat2) =
      exp (↑α * I) • (hadamard * !![1, 0; 0, exp (-(↑(2 * α) * I))] * hadamard) := by
  have h22 : ((Real.sqrt 2 : ℝ) : ℂ) ^ 2 = 2 := by
    rw [← Complex.ofReal_pow, Real.sq_sqrt (by norm_num)]
    norm_num
  have hu : exp (↑α * I) ≠ 0 := exp_ne_zero _
  have h1 : exp (-(↑α * I)) = (exp (↑α * I))⁻¹ := exp_neg _
  have h2 : exp (-(↑(2 * α) * I)) = (exp (↑α * I))⁻¹ ^ 2 := by
    rw [← exp_neg, ← exp_nat_mul]
    push_cast
    ring_nf
  have hcos : (Real.cos α : ℂ) = (exp (↑α * I) + (exp (↑α * I))⁻¹) / 2 := by
    rw [Complex.ofReal_cos, Complex.cos, ← h1, neg_mul]
  have hsin : (Real.sin α : ℂ) = ((exp (↑α * I))⁻¹ - exp (↑α * I)) * I / 2 := by
    rw [Complex.ofReal_sin, Complex.sin, ← h1, neg_mul]
  ext i j
  fin_cases i <;> fin_cases j <;>
    simp only [hadamard, Matrix.mul_apply, Fin.sum_univ_two, Matrix.smul_apply, smul_eq_mul,
      Matrix.of_apply, Matrix.cons_val', Matrix.cons_val_zero, Matrix.cons_val_one,
      Matrix.empty_val', Matrix.cons_val_fin_one, Fin.zero_eta, Fin.mk_one, Fin.isValue] <;>
    simp only [h2, hcos, hsin] <;> field_simp <;> ring_nf <;> simp only [h22, Complex.I_sq] <;> ring

/-- Proposition 3.2 (`eq:rx-gate`): `Rx(-π/4) = e^{iπ/8} H T† H`. -/
theorem prop_3_2_rx_gate : rx (-(Real.pi / 4)) =
    exp (↑(Real.pi / 8) * I) • (hadamard * tDagger * hadamard) := by
  have hrx : rx (-(Real.pi / 4)) = !![(Real.cos (Real.pi / 8) : ℂ), I * Real.sin (Real.pi / 8);
      I * Real.sin (Real.pi / 8), (Real.cos (Real.pi / 8) : ℂ)] := by
    rw [rx, show -(Real.pi / 4) / 2 = -(Real.pi / 8) by ring, Real.cos_neg, Real.sin_neg]
    push_cast
    ring_nf
  have ht : tDagger = !![1, 0; 0, exp (-(↑(2 * (Real.pi / 8)) * I))] := by
    rw [tDagger, show 2 * (Real.pi / 8) = Real.pi / 4 by ring]
  rw [hrx, ht, rotation_eq]

/-- Proposition 3.2 (`prop:compile`): on the admissible domain the circuit uses
`n_b n_o + 2 (n_b + n_o) ≤ 96` elementary gates. -/
theorem prop_3_2_gate_count (nb no : ℕ) (h : nb + no ≤ 16) : nb * no + 2 * (nb + no) ≤ 96 := by
  have hprod : nb * no ≤ 64 := by nlinarith [sq_nonneg ((nb : ℤ) - no)]
  omega

/-- Numerical enclosures `0 < u_L < π / 2`, `0.618 < u_1`, and `u_6 < 1.514` for `L ∈ 1..6`. -/
theorem uL_bounds (L : ℕ) (hL1 : 1 ≤ L) (hL6 : L ≤ 6) :
    0 < uL L ∧ uL L < Real.pi / 2 ∧ (618 / 1000 : ℝ) < uL 1 ∧ uL 6 < (1514 / 1000 : ℝ) := by
  have hs5 : Real.sqrt 5 ^ 2 = 5 := Real.sq_sqrt (by norm_num)
  have hs6 : Real.sqrt 6 ^ 2 = 6 := Real.sq_sqrt (by norm_num)
  have h5 : 0 ≤ Real.sqrt 5 := Real.sqrt_nonneg 5
  have h6 : 0 ≤ Real.sqrt 6 := Real.sqrt_nonneg 6
  have hphi_gt : (618 / 1000 : ℝ) < Real.goldenRatio⁻¹ := by
    rw [goldenRatio_inv_eq]
    nlinarith
  have hphi_lt : Real.goldenRatio⁻¹ < (61804 / 100000 : ℝ) := by
    rw [goldenRatio_inv_eq]
    nlinarith
  have hu6 : uL 6 < (1514 / 1000 : ℝ) := by
    simp only [uL, Nat.cast_ofNat]
    nlinarith
  have hle : uL L ≤ uL 6 := by
    unfold uL
    exact mul_le_mul_of_nonneg_left (Real.sqrt_le_sqrt (by exact_mod_cast hL6)) (by linarith)
  have hpos : 0 < uL L := mul_pos (by linarith) (Real.sqrt_pos.mpr (by exact_mod_cast hL1))
  refine ⟨hpos, ?_, by simpa [uL] using hphi_gt, hu6⟩
  linarith [Real.pi_gt_d2]

end Botge

section Relabel

variable {ι ι' : Type*} [Fintype ι] [DecidableEq ι] [Fintype ι'] [DecidableEq ι']

omit [DecidableEq ι] [DecidableEq ι'] in
/-- Relabelling the qubits along `e` leaves the Ising energy unchanged. -/
theorem energy_relabel (e : ι' ≃ ι) (J : ι → ι → ℝ) (x : ι → Fin 2) :
    energy (fun p q ↦ J (e p) (e q)) (x ∘ e) = energy J x := by
  unfold energy
  congr 1
  exact Fintype.sum_equiv e _ _ fun p ↦ Fintype.sum_equiv e _ _ fun q ↦ rfl

/-- Relabelling the qubits along `e` relabels the output amplitudes. -/
theorem psi_relabel (e : ι' ≃ ι) (φ : ℝ) (J : ι → ι → ℝ) (y : ι → Fin 2) :
    psi φ (fun p q ↦ J (e p) (e q)) (y ∘ e) = psi φ J y := by
  rw [psi_apply, psi_apply]
  refine Fintype.sum_equiv (e.arrowCongr (Equiv.refl (Fin 2))) _ _ fun x ↦ ?_
  have hx : (e.arrowCongr (Equiv.refl (Fin 2)) x) ∘ e = x := by
    funext q
    simp [Equiv.arrowCongr_apply]
  congr 1
  · exact Fintype.prod_equiv e _ _ fun q ↦ by simp [Equiv.arrowCongr_apply]
  · rw [isingState, isingState, Fintype.card_congr e, ← energy_relabel e J, hx]

/-- Exchanging the registers reads Botge's coupling through `Equiv.sumComm`. -/
theorem coupling_swap (nb no L : ℕ) (p q : Fin no ⊕ Fin nb) :
    coupling no nb L p q =
      coupling nb no L (Equiv.sumComm _ _ p) (Equiv.sumComm _ _ q) := by
  rcases p with l | j <;> rcases q with l' | j' <;>
    simp only [coupling, theta, Equiv.sumComm_apply, Sum.swap_inl, Sum.swap_inr, max_comm] <;>
    ring

end Relabel

end

end BotgeLean
