/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.Circuit
import Mathlib.Algebra.BigOperators.Field
import Mathlib.Tactic.Polynomial.Basic
import Mathlib.Tactic.ReduceModChar

/-!
# Palindromic symmetry and bitwise correlations (Theorem 4.3 (1)–(2), `thm:bitwise-corr`)

For any symmetric coupling `J` with zero diagonal, the readout of the Ising phase state through a
uniform `Rx(φ)` layer is invariant under the global bit flip `X^{⊗ ι}`. Hence the Born law is
complement-invariant, every odd-weight Pauli-`Z` moment vanishes, and every single bit is
uniform.

The two-point function has the closed form (`isingTwoPoint`)

`E_φ[Z_p Z_q] = (sin 2φ / 2) sin J_pq (∏_{r≠p,q} cos J_pr + ∏_{r≠p,q} cos J_qr)
  + (sin² φ / 2) (∏_{r≠p,q} cos (J_pr - J_qr) - ∏_{r≠p,q} cos (J_pr + J_qr))`,

derived in the computational basis: every expectation reduces to sums over basis states of
products of single-qubit factors, which factorize through Mathlib's `Fintype.prod_sum`. Botge's
couplings specialize it to `eq:bitwise-corr` and `eq:intra-corr`.
-/

open Complex Finset

namespace BotgeLean

@[expose] public section

variable {ι : Type*} [Fintype ι] [DecidableEq ι]

/-- Expectation `E[f] = ∑_y P(y) f(y)` under the Born law of the `Rx(φ)` readout. -/
noncomputable def expect (φ : ℝ) (J : ι → ι → ℝ) (f : (ι → Fin 2) → ℝ) : ℝ :=
  ∑ y, born φ J y * f y

/-- Relabelling the qubits along `e` leaves every expectation unchanged. -/
theorem expect_relabel {ι' : Type*} [Fintype ι'] [DecidableEq ι'] (e : ι' ≃ ι) (φ : ℝ)
    (J : ι → ι → ℝ) (f : (ι → Fin 2) → ℝ) :
    expect φ (fun p q ↦ J (e p) (e q)) (fun y ↦ f (y ∘ e.symm)) = expect φ J f := by
  refine Fintype.sum_equiv (e.arrowCongr (Equiv.refl (Fin 2))) _ _ fun y ↦ ?_
  have hy : y = (e.arrowCongr (Equiv.refl (Fin 2)) y) ∘ e := by
    funext q
    simp [Equiv.arrowCongr_apply]
  have hb : born φ (fun p q ↦ J (e p) (e q)) y =
      born φ J (e.arrowCongr (Equiv.refl (Fin 2)) y) := by
    conv_lhs => rw [hy]
    rw [born, born, psi_relabel]
  rw [hb]
  rfl

/-! ### Palindromic symmetry -/

omit [DecidableEq ι] in
/-- Bitwise complement leaves the Ising energy unchanged. -/
theorem energy_compl (J : ι → ι → ℝ) (x : ι → Fin 2) : energy J (complEquiv ι x) = energy J x := by
  simp only [energy, complEquiv_apply, spin_rev]
  congr 1
  refine Finset.sum_congr rfl fun p _ ↦ Finset.sum_congr rfl fun q _ ↦ ?_
  ring

/-- Reversing both indices leaves the matrix entry of `Rx(φ)` unchanged. -/
theorem rx_rev (φ : ℝ) (a b : Fin 2) : rx φ a.rev b.rev = rx φ a b := by
  fin_cases a <;> fin_cases b <;> rfl

omit [DecidableEq ι] in
/-- The Ising phase state is invariant under bitwise complement. -/
theorem isingState_compl (J : ι → ι → ℝ) (x : ι → Fin 2) :
    isingState J (complEquiv ι x) = isingState J x := by
  rw [isingState, isingState, energy_compl]

/-- Theorem 4.3 (1): `X^{⊗ ι} |ψ⟩ = |ψ⟩` for every readout angle `φ`. -/
theorem thm_4_3_psi_compl (φ : ℝ) (J : ι → ι → ℝ) (y : ι → Fin 2) :
    psi φ J (complEquiv ι y) = psi φ J y := by
  rw [psi_apply, psi_apply, ← (complEquiv ι).sum_comp]
  refine Finset.sum_congr rfl fun x _ ↦ ?_
  simp only [complEquiv_apply, rx_rev, isingState_compl]

/-- Theorem 4.3 (1): `X^{⊗ ι} |ψ⟩ = |ψ⟩` as a matrix-vector identity. -/
theorem thm_4_3_psi_pauliX (φ : ℝ) (J : ι → ι → ℝ) :
    Matrix.mulVec (tensor fun _ : ι ↦ pauliX) (psi φ J) = psi φ J := by
  rw [tensor_pauliX_mulVec]
  funext y
  exact thm_4_3_psi_compl φ J y

/-- Theorem 4.3 (1): joint complement invariance `P(x̄) = P(x)` of the Born law. -/
theorem thm_4_3_born_compl (φ : ℝ) (J : ι → ι → ℝ) (y : ι → Fin 2) :
    born φ J (complEquiv ι y) = born φ J y := by
  rw [born, born, thm_4_3_psi_compl]

/-- Born probabilities are nonnegative. -/
theorem born_nonneg (φ : ℝ) (J : ι → ι → ℝ) (y : ι → Fin 2) : 0 ≤ born φ J y :=
  Complex.normSq_nonneg _

/-- Theorem 4.3 (1): every odd-weight Pauli-`Z` product has zero expectation. -/
theorem thm_4_3_odd_moment (φ : ℝ) (J : ι → ι → ℝ) (S : Finset ι) (hS : Odd S.card) :
    expect φ J (fun y ↦ ∏ q ∈ S, spin (y q)) = 0 := by
  have hflip : expect φ J (fun y ↦ ∏ q ∈ S, spin (y q)) =
      -expect φ J (fun y ↦ ∏ q ∈ S, spin (y q)) := by
    conv_lhs => rw [expect, ← (complEquiv ι).sum_comp]
    simp only [thm_4_3_born_compl, complEquiv_apply, spin_rev, Finset.prod_neg, hS.neg_one_pow,
      expect, neg_one_mul, mul_neg, Finset.sum_neg_distrib]
  linarith

/-- Theorem 4.3 (1): every single bit has zero mean spin. -/
theorem thm_4_3_mean_spin (φ : ℝ) (J : ι → ι → ℝ) (p : ι) :
    expect φ J (fun y ↦ spin (y p)) = 0 := by
  simpa using thm_4_3_odd_moment φ J {p} (by simp)

/-- The probability of an event under the Born law. -/
noncomputable def prob (φ : ℝ) (J : ι → ι → ℝ) (E : (ι → Fin 2) → Prop) [DecidablePred E] : ℝ :=
  ∑ y with E y, born φ J y

/-- Theorem 4.3 (1): every single bit is uniform, `P(B_j = 0) = 1/2`. -/
theorem thm_4_3_uniform_bit (φ : ℝ) (J : ι → ι → ℝ) (p : ι) :
    prob φ J (fun y ↦ y p = 0) = 1 / 2 := by
  have hmean := thm_4_3_mean_spin φ J p
  have hsum := sum_born φ J
  have hspin : ∀ y : ι → Fin 2, spin (y p) = 2 * (if y p = 0 then 1 else 0) - 1 := by
    intro y
    rcases Fin.exists_fin_two.mp ⟨y p, rfl⟩ with h | h <;> norm_num [h]
  have hsplit : expect φ J (fun y ↦ spin (y p)) =
      2 * prob φ J (fun y ↦ y p = 0) - ∑ y, born φ J y := by
    rw [expect, prob, Finset.sum_filter, Finset.mul_sum, ← Finset.sum_sub_distrib]
    refine Finset.sum_congr rfl fun y _ ↦ ?_
    rw [hspin]
    split_ifs <;> ring
  linarith

/-! ### Exponential sums over spins -/

/-- A weighted spin-exponential sum factorizes over qubits. -/
theorem sum_prod_exp (w : ι → Fin 2 → ℂ) (c : ι → ℝ) :
    ∑ x : ι → Fin 2, (∏ r, w r (x r)) * exp (↑(∑ r, c r * spin (x r)) * I) =
      ∏ r, (w r 0 * exp (↑(c r) * I) + w r 1 * exp (-(↑(c r) * I))) := by
  have hexp : ∀ x : ι → Fin 2, exp (↑(∑ r, c r * spin (x r)) * I) =
      ∏ r, exp (↑(c r * spin (x r)) * I) := by
    intro x
    rw [← exp_sum]
    push_cast
    rw [Finset.sum_mul]
  simp only [hexp, ← Finset.prod_mul_distrib]
  refine (Fintype.prod_sum fun r a ↦ w r a * exp (↑(c r * spin a) * I)).symm.trans ?_
  refine Finset.prod_congr rfl fun r _ ↦ ?_
  simp [Fin.sum_univ_two, neg_mul]

/-- `e^{i s h} = cos h + i s sin h` for a spin `s = ±1`. -/
theorem exp_spin_mul (a : Fin 2) (h : ℝ) :
    exp (↑(spin a * h) * I) = ↑(Real.cos h) + I * ↑(spin a) * ↑(Real.sin h) := by
  rcases Fin.exists_fin_two.mp ⟨a, rfl⟩ with ha | ha <;> subst ha
  · simp only [spin_zero, one_mul, Complex.exp_mul_I, Complex.ofReal_cos, Complex.ofReal_sin,
      Complex.ofReal_one]
    ring
  · simp only [spin_one, neg_one_mul, Complex.ofReal_neg, Complex.exp_mul_I, Complex.cos_neg,
      Complex.sin_neg, Complex.ofReal_cos, Complex.ofReal_sin, Complex.ofReal_one]
    ring

/-- Addition in `Fin 2` multiplies spins: `spin (a + b) = spin a * spin b`. -/
theorem spin_add (a b : Fin 2) : spin (a + b) = spin a * spin b := by
  fin_cases a <;> fin_cases b <;> norm_num [spin]

/-! ### The two-point function -/

/-- Heisenberg-picture entries of `Rx(φ)† W Rx(φ)` for `W ∈ {Z, I}`, written as a sum over the
bit flip `k` that the entry applies: `Z` maps to `cos φ Z + sin φ Y`, and `I` stays `I`. -/
noncomputable def heis (φ : ℝ) (special : Bool) (k a : Fin 2) : ℂ :=
  if special then (if k = 0 then (Real.cos φ : ℂ) * spin a else -I * Real.sin φ * spin a)
  else (if k = 0 then 1 else 0)

private theorem heis_entry_aux (c s : ℝ) (h1 : c ^ 2 + s ^ 2 = 1) (special : Bool)
    (a a' : Fin 2) :
    ∑ e, (starRingEnd ℂ) ((!![(c : ℂ), -(I * s); -(I * s), (c : ℂ)] : Mat2) e a) *
        (!![(c : ℂ), -(I * s); -(I * s), (c : ℂ)] : Mat2) e a' *
        (if special then (spin e : ℂ) else 1) =
      ∑ k : Fin 2, if a' = a + k then
        (if special then (if k = 0 then ((c ^ 2 - s ^ 2 : ℝ) : ℂ) * spin a
          else -I * ((2 * s * c : ℝ) : ℂ) * spin a) else (if k = 0 then 1 else 0)) else 0 := by
  have h1C : (c : ℂ) ^ 2 + (s : ℂ) ^ 2 = 1 := by exact_mod_cast h1
  cases special <;> fin_cases a <;> fin_cases a' <;>
    simp [Fin.sum_univ_two, Complex.conj_ofReal] <;>
    ring_nf <;> simp only [Complex.I_sq] <;>
    first | ring1 | linear_combination h1C

private theorem heis_entry (φ : ℝ) (special : Bool) (a a' : Fin 2) :
    ∑ e, (starRingEnd ℂ) (rx φ e a) * rx φ e a' * (if special then (spin e : ℂ) else 1) =
      ∑ k, if a' = a + k then heis φ special k a else 0 := by
  have hc : Real.cos φ = Real.cos (φ / 2) ^ 2 - Real.sin (φ / 2) ^ 2 := by
    rw [← Real.cos_two_mul', show 2 * (φ / 2) = φ by ring]
  have hs : Real.sin φ = 2 * Real.sin (φ / 2) * Real.cos (φ / 2) := by
    rw [← Real.sin_two_mul, show 2 * (φ / 2) = φ by ring]
  unfold heis
  rw [hc, hs]
  exact heis_entry_aux _ _ (Real.cos_sq_add_sin_sq _) special a a'

omit [DecidableEq ι] in
private theorem prod_ite_eq_ite_pi (x x' k : ι → Fin 2) (g : ι → ℂ) :
    ∏ r, (if x' r = x r + k r then g r else 0) =
      if x' = fun r ↦ x r + k r then ∏ r, g r else 0 := by
  split_ifs with h
  · exact Finset.prod_congr rfl fun r _ ↦ by simp [h]
  · obtain ⟨r, hr⟩ := Function.ne_iff.mp h
    exact Finset.prod_eq_zero (Finset.mem_univ r) (by simp [hr])

private theorem pair_weight (p q : ι) (hpq : p ≠ q) (y : ι → Fin 2) :
    (∏ r, if (r = p ∨ r = q) then (spin (y r) : ℂ) else 1) = spin (y p) * spin (y q) := by
  rw [Finset.prod_ite, Finset.prod_const_one, mul_one]
  have : Finset.univ.filter (fun r ↦ r = p ∨ r = q) = {p, q} := by
    ext r
    simp
  rw [this, Finset.prod_pair hpq]

/-- The Heisenberg step: `E_φ[Z_p Z_q]` as a double sum over basis states `x` and flip patterns
`k` of Ising-state overlaps `⟨x|ψ₀⟩* ⟨x ⊕ k|ψ₀⟩`. -/
theorem expect_two_point_expand (φ : ℝ) (J : ι → ι → ℝ) (p q : ι) (hpq : p ≠ q) :
    ((expect φ J fun y ↦ spin (y p) * spin (y q) : ℝ) : ℂ) =
      ∑ x, ∑ k : ι → Fin 2, (∏ r, heis φ (decide (r = p ∨ r = q)) (k r) (x r)) *
        ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + k r) := by
  set W : ι → Fin 2 → ℂ := fun r e ↦ if (decide (r = p ∨ r = q)) then (spin e : ℂ) else 1
  have hW : ∀ y : ι → Fin 2, ((spin (y p) * spin (y q) : ℝ) : ℂ) = ∏ r, W r (y r) := by
    intro y
    simp only [W, decide_eq_true_eq]
    rw [pair_weight p q hpq]
    push_cast
    rfl
  -- Expand `|⟨y|ψ⟩|² w(y)` into a double sum over basis states.
  have h1 : ((expect φ J fun y ↦ spin (y p) * spin (y q) : ℝ) : ℂ) =
      ∑ x, ∑ x', (starRingEnd ℂ) (isingState J x) * isingState J x' *
        ∏ r, ∑ e, (starRingEnd ℂ) (rx φ e (x r)) * rx φ e (x' r) * W r e := by
    have hy : ∀ y, (normSq (psi φ J y) : ℂ) * ∏ r, W r (y r) =
        ∑ x, ∑ x', (starRingEnd ℂ) (isingState J x) * isingState J x' *
          ∏ r, ((starRingEnd ℂ) (rx φ (y r) (x r)) * rx φ (y r) (x' r) * W r (y r)) := by
      intro y
      rw [normSq_eq_conj_mul_self, psi_apply, map_sum, Finset.sum_mul_sum, Finset.sum_mul]
      refine Finset.sum_congr rfl fun x _ ↦ ?_
      rw [Finset.sum_mul]
      refine Finset.sum_congr rfl fun x' _ ↦ ?_
      simp only [map_mul, map_prod, Finset.prod_mul_distrib]
      ring
    simp only [expect, born, Complex.ofReal_sum, Complex.ofReal_mul, hW, hy]
    rw [Finset.sum_comm]
    refine Finset.sum_congr rfl fun x _ ↦ ?_
    rw [Finset.sum_comm]
    refine Finset.sum_congr rfl fun x' _ ↦ ?_
    rw [← Finset.mul_sum, Fintype.prod_sum]
  rw [h1]
  refine Finset.sum_congr rfl fun x _ ↦ ?_
  simp only [W, heis_entry]
  simp only [Fintype.prod_sum, prod_ite_eq_ite_pi, Finset.mul_sum]
  rw [Finset.sum_comm]
  refine Finset.sum_congr rfl fun k _ ↦ ?_
  simp only [mul_ite, mul_zero, Finset.sum_ite_eq', Finset.mem_univ, ite_true]
  ring

omit [DecidableEq ι] in
/-- `⟨x|ψ₀⟩* ⟨x'|ψ₀⟩ = 2^{-n} e^{i (V(x) - V(x'))}`. -/
theorem conj_isingState_mul (J : ι → ι → ℝ) (x x' : ι → Fin 2) :
    (starRingEnd ℂ) (isingState J x) * isingState J x' =
      ((2 : ℂ) ^ Fintype.card ι)⁻¹ * exp (↑(energy J x - energy J x') * I) := by
  have h2 : ((Real.sqrt 2 : ℝ) : ℂ)⁻¹ * ((Real.sqrt 2 : ℝ) : ℂ)⁻¹ = 2⁻¹ := by
    rw [← mul_inv, ← Complex.ofReal_mul, Real.mul_self_sqrt (by norm_num)]
    norm_num
  simp only [isingState, map_mul, map_pow, map_inv₀, Complex.conj_ofReal, ← exp_conj, map_neg,
    Complex.conj_I]
  rw [mul_mul_mul_comm, ← mul_pow, h2, ← exp_add, inv_pow]
  congr 2
  push_cast
  ring

/-- Flip indicator `f_r = (1 - s(k_r)) / 2 ∈ {0, 1}` of a flip pattern. -/
noncomputable def flipInd (k : ι → Fin 2) (r : ι) : ℝ := (1 - spin (k r)) / 2

omit [DecidableEq ι] in
/-- Energy change under the bit flip `k`:
`V(x) - V(x ⊕ k) = ∑_r f_r s_r h_r - ∑_{r,t} f_r f_t J_rt s_r s_t` with `h_r = ∑_t J_rt s_t`. -/
theorem energy_sub_xor (J : ι → ι → ℝ) (hJ : ∀ r t, J r t = J t r) (x k : ι → Fin 2) :
    energy J x - energy J (fun r ↦ x r + k r) =
      ∑ r, flipInd k r * spin (x r) * ∑ t, J r t * spin (x t) -
        ∑ r, ∑ t, flipInd k r * flipInd k t * J r t * spin (x r) * spin (x t) := by
  have hsymm : ∑ r, ∑ t, J r t * spin (x r) * spin (x t) * spin (k r) =
      ∑ r, ∑ t, J r t * spin (x r) * spin (x t) * spin (k t) := by
    rw [Finset.sum_comm]
    refine Finset.sum_congr rfl fun r _ ↦ Finset.sum_congr rfl fun t _ ↦ ?_
    rw [hJ]
    ring
  suffices h : energy J x - energy J (fun r ↦ x r + k r) -
      (∑ r, flipInd k r * spin (x r) * ∑ t, J r t * spin (x t) -
        ∑ r, ∑ t, flipInd k r * flipInd k t * J r t * spin (x r) * spin (x t)) =
      (1 / 4) * (∑ r, ∑ t, J r t * spin (x r) * spin (x t) * spin (k r) -
        ∑ r, ∑ t, J r t * spin (x r) * spin (x t) * spin (k t)) by
    rw [hsymm, sub_self, mul_zero, sub_eq_zero] at h
    exact h
  simp only [energy, flipInd, spin_add, Finset.mul_sum, ← Finset.sum_sub_distrib]
  refine Finset.sum_congr rfl fun r _ ↦ Finset.sum_congr rfl fun t _ ↦ ?_
  ring

/-- The qubits other than `p` and `q`. -/
def rest (p q : ι) : Finset ι := (Finset.univ.erase p).erase q

/-- Splits a full product over `ι` into `p`, `q`, and `rest p q`. -/
theorem prod_split (p q : ι) (hpq : p ≠ q) {M : Type*} [CommMonoid M] (f : ι → M) :
    ∏ r, f r = f p * f q * ∏ r ∈ rest p q, f r := by
  rw [← Finset.mul_prod_erase _ _ (Finset.mem_univ p), rest,
    ← Finset.mul_prod_erase _ _ (Finset.mem_erase.mpr ⟨hpq.symm, Finset.mem_univ q⟩), mul_assoc]

/-- Removing two distinct qubits leaves `card ι - 2` qubits. -/
theorem card_rest (p q : ι) (hpq : p ≠ q) : (rest p q).card + 2 = Fintype.card ι := by
  have hp : p ∈ (Finset.univ : Finset ι) := Finset.mem_univ p
  have hq : q ∈ (Finset.univ : Finset ι).erase p :=
    Finset.mem_erase.mpr ⟨hpq.symm, Finset.mem_univ q⟩
  rw [rest, Finset.card_erase_of_mem hq, Finset.card_erase_of_mem hp, Finset.card_univ]
  have : 1 < Fintype.card ι := by
    rw [← Finset.card_univ]
    exact Finset.one_lt_card.mpr ⟨p, Finset.mem_univ _, q, Finset.mem_univ _, hpq⟩
  omega

/-- Spin-weighted cosine/sine factor `2 i sin c` (weighted) or `2 cos c` (unweighted). -/
noncomputable def spinFactor (weighted : Bool) (c : ℝ) : ℂ :=
  if weighted then 2 * I * Real.sin c else 2 * Real.cos c

private theorem factor_eval (weighted : Bool) (c : ℝ) :
    (if weighted then (spin 0 : ℂ) else 1) * exp (↑c * I) +
        (if weighted then (spin 1 : ℂ) else 1) * exp (-(↑c * I)) = spinFactor weighted c := by
  cases weighted
  · simp [spinFactor, Complex.ofReal_cos, Complex.cos]
    ring
  · simp [spinFactor, Complex.ofReal_sin, Complex.sin]
    ring_nf
    simp only [Complex.I_sq]
    ring

/-- Spin-weighted exponential sum: `∑_x (∏_{r∈S} s_r) e^{i ∑ c_r s_r} = ∏_r factor_r`. -/
theorem sum_spin_exp (S : Finset ι) (c : ι → ℝ) :
    ∑ x : ι → Fin 2, (∏ r ∈ S, (spin (x r) : ℂ)) * exp (↑(∑ r, c r * spin (x r)) * I) =
      ∏ r, spinFactor (decide (r ∈ S)) (c r) := by
  have hw : ∀ x : ι → Fin 2, ∏ r ∈ S, (spin (x r) : ℂ) =
      ∏ r, (if decide (r ∈ S) then (spin (x r) : ℂ) else 1) := by
    intro x
    simp only [decide_eq_true_eq]
    rw [Finset.prod_ite_mem, Finset.univ_inter]
  simp only [hw]
  rw [sum_prod_exp (fun r a ↦ if decide (r ∈ S) then (spin a : ℂ) else 1) c]
  exact Finset.prod_congr rfl fun r _ ↦ factor_eval _ _

/-- Cosine sums: `∑_x (∏_{r∈S} s_r) cos(∑ c_r s_r)` is the factor product for `|S|` even and `0`
for `|S|` odd. -/
theorem sum_spin_cos (S : Finset ι) (c : ι → ℝ) :
    ∑ x : ι → Fin 2, (∏ r ∈ S, (spin (x r) : ℂ)) * ↑(Real.cos (∑ r, c r * spin (x r))) =
      (∏ r, spinFactor (decide (r ∈ S)) (c r) +
        ∏ r, spinFactor (decide (r ∈ S)) (-c r)) / 2 := by
  have hneg := sum_spin_exp S (fun r ↦ -c r)
  have hpos := sum_spin_exp S c
  have hcos : ∀ x : ι → Fin 2, (↑(Real.cos (∑ r, c r * spin (x r))) : ℂ) =
      (exp (↑(∑ r, c r * spin (x r)) * I) + exp (↑(∑ r, -c r * spin (x r)) * I)) / 2 := by
    intro x
    rw [Complex.ofReal_cos, Complex.cos]
    congr 2
    push_cast
    simp [Finset.sum_neg_distrib, neg_mul]
  simp only [hcos, mul_div_assoc', mul_add]
  rw [← Finset.sum_div, Finset.sum_add_distrib, hpos, hneg]

/-- Sine sums: `∑_x (∏_{r∈S} s_r) sin(∑ c_r s_r) = (P(c) - P(-c)) / 2i`. -/
theorem sum_spin_sin (S : Finset ι) (c : ι → ℝ) :
    ∑ x : ι → Fin 2, (∏ r ∈ S, (spin (x r) : ℂ)) * ↑(Real.sin (∑ r, c r * spin (x r))) =
      (∏ r, spinFactor (decide (r ∈ S)) (c r) -
        ∏ r, spinFactor (decide (r ∈ S)) (-c r)) / (2 * I) := by
  have hneg := sum_spin_exp S (fun r ↦ -c r)
  have hpos := sum_spin_exp S c
  have hsin : ∀ x : ι → Fin 2, (↑(Real.sin (∑ r, c r * spin (x r))) : ℂ) =
      (exp (↑(∑ r, c r * spin (x r)) * I) - exp (↑(∑ r, -c r * spin (x r)) * I)) / (2 * I) := by
    intro x
    rw [Complex.ofReal_sin, Complex.sin]
    have : exp (↑(∑ r, -c r * spin (x r)) * I) = exp (-(↑(∑ r, c r * spin (x r))) * I) := by
      push_cast
      simp [Finset.sum_neg_distrib, neg_mul]
    rw [this]
    field_simp
    ring_nf
    simp only [Complex.I_sq]
    ring
  simp only [hsin, mul_div_assoc', mul_sub]
  rw [← Finset.sum_div, Finset.sum_sub_distrib, hpos, hneg]

/-- Lemma 4.2 (4) (`eq:trig-plus-exp`): in `|+⟩^{⊗ |ι|}`, `E[cos(∑ β_q Z_q)] = ∏ cos β_q`
and `E[sin(∑ β_q Z_q)] = 0`. -/
theorem lem_4_2_trig_plus_exp (β : ι → ℝ) :
    ((2 : ℝ) ^ Fintype.card ι)⁻¹ *
        ∑ x : ι → Fin 2, Real.cos (∑ q, β q * spin (x q)) = ∏ q, Real.cos (β q) ∧
      ((2 : ℝ) ^ Fintype.card ι)⁻¹ *
        ∑ x : ι → Fin 2, Real.sin (∑ q, β q * spin (x q)) = 0 := by
  have hcos_sum : (∑ x : ι → Fin 2, (Real.cos (∑ q, β q * spin (x q)) : ℂ)) =
      (2 : ℂ) ^ Fintype.card ι * ∏ q, (Real.cos (β q) : ℂ) := by
    have h := sum_spin_cos (∅ : Finset ι) β
    simp only [Finset.prod_empty, one_mul, Finset.notMem_empty, decide_false, spinFactor,
      Bool.false_eq_true, ↓reduceIte, Real.cos_neg] at h
    rw [h, Finset.prod_mul_distrib, Finset.prod_const, Finset.card_univ]
    ring
  have hsin_sum : (∑ x : ι → Fin 2, (Real.sin (∑ q, β q * spin (x q)) : ℂ)) = 0 := by
    have h := sum_spin_sin (∅ : Finset ι) β
    simp only [Finset.prod_empty, one_mul, Finset.notMem_empty, decide_false, spinFactor,
      Bool.false_eq_true, ↓reduceIte, Real.cos_neg, sub_self, zero_div] at h
    exact h
  constructor <;> apply Complex.ofReal_injective
  · simp only [Complex.ofReal_mul, Complex.ofReal_inv, Complex.ofReal_pow, Complex.ofReal_ofNat,
      Complex.ofReal_sum, Complex.ofReal_prod, hcos_sum]
    field_simp
  · simp only [Complex.ofReal_mul, Complex.ofReal_inv, Complex.ofReal_pow, Complex.ofReal_ofNat,
      Complex.ofReal_sum, Complex.ofReal_zero, hsin_sum, mul_zero]

/-- The flip pattern acting on `p` with bit `a` and on `q` with bit `b`. -/
def flip2 (p q : ι) (a b : Fin 2) : ι → Fin 2 := Function.update (Function.update 0 p a) q b

omit [Fintype ι] in
/-- Value of `flip2 p q a b` at `p`. -/
theorem flip2_p {p q : ι} (hpq : p ≠ q) (a b : Fin 2) : flip2 p q a b p = a := by
  simp [flip2, hpq]

omit [Fintype ι] in
/-- Value of `flip2 p q a b` at `q`. -/
theorem flip2_q (p q : ι) (a b : Fin 2) : flip2 p q a b q = b := by
  simp [flip2]

omit [Fintype ι] in
/-- Value of `flip2 p q a b` off `{p, q}`. -/
theorem flip2_rest {p q r : ι} (hp : r ≠ p) (hq : r ≠ q) (a b : Fin 2) : flip2 p q a b r = 0 := by
  simp [flip2, hp, hq]

/-- Membership in `rest p q`. -/
theorem mem_rest {p q r : ι} : r ∈ rest p q ↔ r ≠ q ∧ r ≠ p := by
  simp [rest]

/-- Only the four flip patterns supported on `{p, q}` survive the Heisenberg expansion. -/
theorem sum_flip_patterns (φ : ℝ) (p q : ι) (hpq : p ≠ q) (x : ι → Fin 2)
    (G : (ι → Fin 2) → ℂ) :
    ∑ k : ι → Fin 2, (∏ r, heis φ (decide (r = p ∨ r = q)) (k r) (x r)) * G k =
      ∑ a : Fin 2, ∑ b : Fin 2, heis φ true a (x p) * heis φ true b (x q) * G (flip2 p q a b) := by
  have hprod : ∀ k : ι → Fin 2, ∏ r, heis φ (decide (r = p ∨ r = q)) (k r) (x r) =
      if k = flip2 p q (k p) (k q) then heis φ true (k p) (x p) * heis φ true (k q) (x q)
      else 0 := by
    intro k
    rw [prod_split p q hpq]
    have hrest : ∏ r ∈ rest p q, heis φ (decide (r = p ∨ r = q)) (k r) (x r) =
        if k = flip2 p q (k p) (k q) then 1 else 0 := by
      have : ∀ r ∈ rest p q, heis φ (decide (r = p ∨ r = q)) (k r) (x r) =
          if k r = 0 then 1 else 0 := by
        intro r hr
        obtain ⟨hrq, hrp⟩ := mem_rest.mp hr
        simp [heis, hrq, hrp]
      rw [Finset.prod_congr rfl this, Finset.prod_boole]
      congr 1
      apply propext
      constructor
      · intro h
        funext r
        by_cases hrp : r = p
        · subst hrp
          rw [flip2_p hpq]
        · by_cases hrq : r = q
          · subst hrq
            rw [flip2_q]
          · rw [flip2_rest hrp hrq, h r (mem_rest.mpr ⟨hrq, hrp⟩)]
      · intro h r hr
        obtain ⟨hrq, hrp⟩ := mem_rest.mp hr
        rw [h, flip2_rest hrp hrq]
    rw [hrest]
    simp only [true_or, or_true, decide_true, mul_ite, mul_one, mul_zero]
  simp only [hprod, ite_mul, zero_mul]
  rw [← Finset.sum_filter]
  have himage : Finset.univ.filter (fun k : ι → Fin 2 ↦ k = flip2 p q (k p) (k q)) =
      (Finset.univ : Finset (Fin 2 × Fin 2)).image fun ab ↦ flip2 p q ab.1 ab.2 := by
    ext k
    simp only [Finset.mem_filter, Finset.mem_univ, true_and, Finset.mem_image, Prod.exists]
    constructor
    · intro h
      exact ⟨k p, k q, h.symm⟩
    · rintro ⟨a, b, rfl⟩
      rw [flip2_p hpq, flip2_q]
  have hinj : Set.InjOn (fun ab : Fin 2 × Fin 2 ↦ flip2 p q ab.1 ab.2)
      ↑(Finset.univ : Finset (Fin 2 × Fin 2)) := by
    rintro ⟨a, b⟩ - ⟨a', b'⟩ - h
    have hp := congrFun h p
    have hq := congrFun h q
    simp only [flip2_p hpq, flip2_q] at hp hq
    rw [hp, hq]
  rw [himage, Finset.sum_image hinj, Fintype.sum_prod_type]
  simp only [flip2_p hpq, flip2_q]

/-- Factors `2^|rest p q|` out of a cosine product over `rest p q`. -/
theorem prod_rest_two_mul (p q : ι) (g : ι → ℝ) :
    ∏ r ∈ rest p q, (2 * (Real.cos (g r) : ℂ)) =
      (2 : ℂ) ^ (rest p q).card * ∏ r ∈ rest p q, (Real.cos (g r) : ℂ) := by
  rw [Finset.prod_mul_distrib, Finset.prod_const]

omit [Fintype ι] [DecidableEq ι] in
/-- Indicator form `flipInd k r = if k r = 1 then 1 else 0`. -/
theorem flipInd_eq (k : ι → Fin 2) (r : ι) : flipInd k r = if k r = 1 then 1 else 0 := by
  rcases Fin.exists_fin_two.mp ⟨k r, rfl⟩ with h | h <;> simp [flipInd, h]

/-- Flipping `p` alone changes the energy by `s_p h_p`. -/
theorem energy_sub_flip_one (J : ι → ι → ℝ) (hJ : ∀ r t, J r t = J t r) (hJ0 : ∀ r, J r r = 0)
    {p q : ι} (hpq : p ≠ q) (x : ι → Fin 2) :
    energy J x - energy J (fun r ↦ x r + flip2 p q 1 0 r) =
      spin (x p) * ∑ t, J p t * spin (x t) := by
  have hf : ∀ r, flipInd (flip2 p q 1 0) r = if r = p then 1 else 0 := by
    intro r
    rw [flipInd_eq]
    by_cases hrp : r = p
    · subst hrp
      simp [flip2_p hpq]
    · by_cases hrq : r = q
      · subst hrq
        simp [flip2_q, hrp]
      · simp [flip2_rest hrp hrq, hrp]
  have hdouble : ∑ r, ∑ t, flipInd (flip2 p q 1 0) r * flipInd (flip2 p q 1 0) t * J r t *
      spin (x r) * spin (x t) = 0 := by
    refine Finset.sum_eq_zero fun r _ ↦ Finset.sum_eq_zero fun t _ ↦ ?_
    rw [hf, hf]
    split_ifs with h1 h2 <;> simp_all
  rw [energy_sub_xor J hJ, hdouble, sub_zero]
  simp only [hf, ite_mul, one_mul, zero_mul, Finset.sum_ite_eq', Finset.mem_univ, ite_true]

/-- The one-flip overlap sum. -/
theorem sum_one_flip (φ : ℝ) (J : ι → ι → ℝ) (hJ : ∀ r t, J r t = J t r) (hJ0 : ∀ r, J r r = 0)
    {p q : ι} (hpq : p ≠ q) :
    ∑ x, heis φ true 1 (x p) * heis φ true 0 (x q) *
        ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + flip2 p q 1 0 r) =
      ((Real.sin φ * Real.cos φ * Real.sin (J p q) * ∏ r ∈ rest p q, Real.cos (J p r) : ℝ) :
        ℂ) := by
  have hpt : ∀ x : ι → Fin 2, heis φ true 1 (x p) * heis φ true 0 (x q) *
      ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + flip2 p q 1 0 r) =
      ((2 : ℂ) ^ Fintype.card ι)⁻¹ * (-I * Real.sin φ * Real.cos φ) *
        ((∏ r ∈ {p, q}, (spin (x r) : ℂ)) * ↑(Real.cos (∑ t, J p t * spin (x t))) +
          I * ((∏ r ∈ {q}, (spin (x r) : ℂ)) * ↑(Real.sin (∑ t, J p t * spin (x t))))) := by
    intro x
    have hss : (spin (x p) : ℂ) * spin (x p) = 1 := by exact_mod_cast spin_mul_self (x p)
    rw [conj_isingState_mul, energy_sub_flip_one J hJ hJ0 hpq, exp_spin_mul,
      Finset.prod_pair hpq, Finset.prod_singleton]
    simp only [heis, ite_true, one_ne_zero, ite_false]
    linear_combination (((2 : ℂ) ^ Fintype.card ι)⁻¹ * (-I * Real.sin φ * Real.cos φ) * I *
      (spin (x q) : ℂ) * ↑(Real.sin (∑ t, J p t * spin (x t)))) * hss
  simp only [hpt, ← Finset.mul_sum, Finset.sum_add_distrib, sum_spin_cos, sum_spin_sin]
  have hzero : ∀ c : ι → ℝ, c p = 0 →
      ∏ r, spinFactor (decide (r ∈ ({p, q} : Finset ι))) (c r) = 0 := by
    intro c hc
    exact Finset.prod_eq_zero (Finset.mem_univ p) (by simp [spinFactor, hc])
  have hsplit : ∀ s : ℝ, ∏ r, spinFactor (decide (r ∈ ({q} : Finset ι))) (s * J p r) =
      2 * (2 * I * Real.sin (s * J p q)) * ∏ r ∈ rest p q, (2 * (Real.cos (s * J p r) : ℂ)) := by
    intro s
    rw [prod_split p q hpq]
    have hrest : ∀ r ∈ rest p q, spinFactor (decide (r ∈ ({q} : Finset ι))) (s * J p r) =
        2 * (Real.cos (s * J p r) : ℂ) := by
      intro r hr
      simp [spinFactor, (mem_rest.mp hr).1]
    rw [Finset.prod_congr rfl hrest]
    simp [spinFactor, hpq, hJ0]
  have hc1 := hsplit 1
  have hcm := hsplit (-1)
  simp only [one_mul, neg_one_mul, Real.sin_neg, Real.cos_neg] at hc1 hcm
  rw [hzero _ (hJ0 p), hzero _ (by simp [hJ0 p]), hc1, hcm, prod_rest_two_mul]
  have hcard := card_rest p q hpq
  rw [← hcard, pow_add]
  push_cast
  field_simp
  ring_nf
  simp only [Complex.I_sq]
  ring

/-- The punctured coupling row `J_{p,·}` with the entry at `q` removed. -/
def puncture (J : ι → ι → ℝ) (p q : ι) (t : ι) : ℝ := if t = q then 0 else J p t

/-- Sum over the punctured coupling row removes the `q` term. -/
theorem sum_puncture (J : ι → ι → ℝ) (p q : ι) (x : ι → Fin 2) :
    ∑ t, puncture J p q t * spin (x t) = ∑ t, J p t * spin (x t) - J p q * spin (x q) := by
  rw [eq_sub_iff_add_eq, ← Finset.sum_erase_add _ _ (Finset.mem_univ q),
    ← Finset.sum_erase_add _ _ (Finset.mem_univ q)]
  simp only [puncture, ite_true, zero_mul, add_zero]
  exact congrArg (· + _) (Finset.sum_congr rfl fun t ht ↦ by simp [(Finset.mem_erase.mp ht).1])

omit [Fintype ι] in
/-- Evaluates a double sum of a single-entry indicator. -/
theorem sum_sum_ite_ite [Fintype ι] (c : ι → ι → ℝ) (a b : ι) :
    ∑ r, ∑ t, (if r = a then (if t = b then c r t else 0) else 0) = c a b := by
  rw [Finset.sum_eq_single a (fun r _ hr ↦ by simp [hr]) (by simp)]
  simp

/-- Flipping `p` and `q` changes the energy by `s_p A_p + s_q A_q` with punctured fields. -/
theorem energy_sub_flip_two (J : ι → ι → ℝ) (hJ : ∀ r t, J r t = J t r) (hJ0 : ∀ r, J r r = 0)
    {p q : ι} (hpq : p ≠ q) (x : ι → Fin 2) :
    energy J x - energy J (fun r ↦ x r + flip2 p q 1 1 r) =
      spin (x p) * ∑ t, puncture J p q t * spin (x t) +
        spin (x q) * ∑ t, puncture J q p t * spin (x t) := by
  have hf : ∀ r, flipInd (flip2 p q 1 1) r =
      (if r = p then 1 else 0) + (if r = q then 1 else 0) := by
    intro r
    rw [flipInd_eq]
    by_cases hrp : r = p
    · subst hrp
      simp [flip2_p hpq, hpq]
    · by_cases hrq : r = q
      · subst hrq
        simp [flip2_q, hrp]
      · simp [flip2_rest hrp hrq, hrp, hrq]
  rw [energy_sub_xor J hJ, sum_puncture, sum_puncture]
  simp only [hf, add_mul, mul_add, ite_mul, one_mul, zero_mul, Finset.sum_add_distrib,
    Finset.sum_ite_eq', Finset.mem_univ, ite_true, sum_sum_ite_ite, hJ0]
  rw [hJ q p]
  ring

/-- `∏_r factor_r` vanishes as soon as a weighted qubit has zero field. -/
theorem prod_spinFactor_eq_zero (S : Finset ι) (c : ι → ℝ) {r : ι} (hr : r ∈ S) (hc : c r = 0) :
    ∏ t, spinFactor (decide (t ∈ S)) (c t) = 0 :=
  Finset.prod_eq_zero (Finset.mem_univ r) (by simp [spinFactor, hr, hc])

/-- The unweighted factor product: `∏_r 2 cos c_r`, split off `p` and `q`. -/
theorem prod_spinFactor_empty (p q : ι) (hpq : p ≠ q) (c : ι → ℝ) :
    ∏ t, spinFactor (decide (t ∈ (∅ : Finset ι))) (c t) =
      2 * Real.cos (c p) * (2 * Real.cos (c q)) *
        ((2 : ℂ) ^ (rest p q).card * ∏ r ∈ rest p q, (Real.cos (c r) : ℂ)) := by
  rw [prod_split p q hpq, ← prod_rest_two_mul]
  simp [spinFactor]

/-- The two-flip overlap sum. -/
theorem sum_two_flip (φ : ℝ) (J : ι → ι → ℝ) (hJ : ∀ r t, J r t = J t r) (hJ0 : ∀ r, J r r = 0)
    {p q : ι} (hpq : p ≠ q) :
    ∑ x, heis φ true 1 (x p) * heis φ true 1 (x q) *
        ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + flip2 p q 1 1 r) =
      ((Real.sin φ ^ 2 / 2 * (∏ r ∈ rest p q, Real.cos (J p r - J q r) -
        ∏ r ∈ rest p q, Real.cos (J p r + J q r)) : ℝ) : ℂ) := by
  set A : (ι → Fin 2) → ℝ := fun x ↦ ∑ t, puncture J p q t * spin (x t)
  set B : (ι → Fin 2) → ℝ := fun x ↦ ∑ t, puncture J q p t * spin (x t)
  have hplus : ∀ x, ∑ t, (puncture J p q t + puncture J q p t) * spin (x t) = A x + B x := by
    intro x
    simp only [A, B, add_mul, Finset.sum_add_distrib]
  have hminus : ∀ x, ∑ t, (puncture J p q t - puncture J q p t) * spin (x t) = A x - B x := by
    intro x
    simp only [A, B, sub_mul, Finset.sum_sub_distrib]
  have hpt : ∀ x : ι → Fin 2, heis φ true 1 (x p) * heis φ true 1 (x q) *
      ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + flip2 p q 1 1 r) =
      ((2 : ℂ) ^ Fintype.card ι)⁻¹ * (-(Real.sin φ : ℂ) ^ 2) *
        ((1 / 2) * ((∏ r ∈ {p, q}, (spin (x r) : ℂ)) *
            ↑(Real.cos (∑ t, (puncture J p q t + puncture J q p t) * spin (x t)))) +
          (1 / 2) * ((∏ r ∈ {p, q}, (spin (x r) : ℂ)) *
            ↑(Real.cos (∑ t, (puncture J p q t - puncture J q p t) * spin (x t)))) +
          (I / 2) * ((∏ r ∈ {q}, (spin (x r) : ℂ)) *
            ↑(Real.sin (∑ t, (puncture J p q t + puncture J q p t) * spin (x t)))) +
          (I / 2) * ((∏ r ∈ {q}, (spin (x r) : ℂ)) *
            ↑(Real.sin (∑ t, (puncture J p q t - puncture J q p t) * spin (x t)))) +
          (I / 2) * ((∏ r ∈ {p}, (spin (x r) : ℂ)) *
            ↑(Real.sin (∑ t, (puncture J p q t + puncture J q p t) * spin (x t)))) -
          (I / 2) * ((∏ r ∈ {p}, (spin (x r) : ℂ)) *
            ↑(Real.sin (∑ t, (puncture J p q t - puncture J q p t) * spin (x t)))) -
          (1 / 2) * ((∏ r ∈ (∅ : Finset ι), (spin (x r) : ℂ)) *
            ↑(Real.cos (∑ t, (puncture J p q t - puncture J q p t) * spin (x t)))) +
          (1 / 2) * ((∏ r ∈ (∅ : Finset ι), (spin (x r) : ℂ)) *
            ↑(Real.cos (∑ t, (puncture J p q t + puncture J q p t) * spin (x t))))) := by
    intro x
    have hsp : (spin (x p) : ℂ) * spin (x p) = 1 := by exact_mod_cast spin_mul_self (x p)
    have hsq : (spin (x q) : ℂ) * spin (x q) = 1 := by exact_mod_cast spin_mul_self (x q)
    have hexp : exp (↑(spin (x p) * A x + spin (x q) * B x) * I) =
        exp (↑(spin (x p) * A x) * I) * exp (↑(spin (x q) * B x) * I) := by
      rw [← exp_add]
      push_cast
      ring_nf
    rw [conj_isingState_mul, energy_sub_flip_two J hJ hJ0 hpq, hexp, exp_spin_mul, exp_spin_mul,
      Finset.prod_pair hpq, Finset.prod_singleton, Finset.prod_singleton, Finset.prod_empty,
      hplus, hminus, Real.cos_add, Real.cos_sub, Real.sin_add, Real.sin_sub]
    simp only [heis, ite_true, one_ne_zero, ite_false]
    simp only [Complex.ofReal_mul, Complex.ofReal_sub, Complex.ofReal_add]
    have hI : I ^ 2 = -1 := Complex.I_sq
    have hpq2 : (spin (x p) : ℂ) * spin (x p) * ((spin (x q) : ℂ) * spin (x q)) = 1 := by
      rw [hsp, hsq, one_mul]
    set sp : ℂ := (spin (x p) : ℂ)
    set sq : ℂ := (spin (x q) : ℂ)
    set cA : ℂ := (Real.cos (A x) : ℂ)
    set sA : ℂ := (Real.sin (A x) : ℂ)
    set cB : ℂ := (Real.cos (B x) : ℂ)
    set sB : ℂ := (Real.sin (B x) : ℂ)
    linear_combination ((2 : ℂ) ^ Fintype.card ι)⁻¹ * (Real.sin φ : ℂ) ^ 2 *
      ((sp * sq * cA * cB + I * sp * sq ^ 2 * cA * sB + I * sp ^ 2 * sq * sA * cB +
          (I ^ 2 - 1) * sp ^ 2 * sq ^ 2 * sA * sB) * hI -
        I * sp * cA * sB * hsq - I * sq * sA * cB * hsp + sA * sB * hpq2)
  simp only [hpt, ← Finset.mul_sum, Finset.sum_add_distrib, Finset.sum_sub_distrib,
    sum_spin_cos, sum_spin_sin]
  have hpp : puncture J p q p = 0 := by simp [puncture, hpq, hJ0]
  have hqp : puncture J q p p = 0 := by simp [puncture]
  have hpq' : puncture J p q q = 0 := by simp [puncture]
  have hqq : puncture J q p q = 0 := by simp [puncture, hpq.symm, hJ0]
  have hrestp : ∀ r ∈ rest p q, puncture J p q r = J p r := fun r hr ↦ by
    simp [puncture, (mem_rest.mp hr).1]
  have hrestq : ∀ r ∈ rest p q, puncture J q p r = J q r := fun r hr ↦ by
    simp [puncture, (mem_rest.mp hr).2]
  have hz2 : ∀ c : ι → ℝ, c p = 0 → ∏ r, spinFactor (decide (r ∈ ({p, q} : Finset ι))) (c r) = 0 :=
    fun c hc ↦ prod_spinFactor_eq_zero _ c (by simp) hc
  have hzq : ∀ c : ι → ℝ, c q = 0 → ∏ r, spinFactor (decide (r ∈ ({q} : Finset ι))) (c r) = 0 :=
    fun c hc ↦ prod_spinFactor_eq_zero _ c (Finset.mem_singleton_self q) hc
  have hzp : ∀ c : ι → ℝ, c p = 0 → ∏ r, spinFactor (decide (r ∈ ({p} : Finset ι))) (c r) = 0 :=
    fun c hc ↦ prod_spinFactor_eq_zero _ c (Finset.mem_singleton_self p) hc
  have hplusR : ∏ r ∈ rest p q, (Real.cos (puncture J p q r + puncture J q p r) : ℂ) =
      ∏ r ∈ rest p q, (Real.cos (J p r + J q r) : ℂ) :=
    Finset.prod_congr rfl fun r hr ↦ by rw [hrestp r hr, hrestq r hr]
  have hminusR : ∏ r ∈ rest p q, (Real.cos (puncture J p q r - puncture J q p r) : ℂ) =
      ∏ r ∈ rest p q, (Real.cos (J p r - J q r) : ℂ) :=
    Finset.prod_congr rfl fun r hr ↦ by rw [hrestp r hr, hrestq r hr]
  simp (disch := simp [hpp, hqp, hpq', hqq]) only [hz2, hzq, hzp, prod_spinFactor_empty p q hpq]
  simp only [hpp, hqp, hpq', hqq, add_zero, sub_zero, neg_zero, Real.cos_zero, Real.cos_neg,
    hplusR, hminusR]
  rw [← card_rest p q hpq, pow_add]
  push_cast
  field_simp
  ring

/-- `rest p q` is symmetric in `p` and `q`. -/
theorem rest_comm (p q : ι) : rest p q = rest q p := by
  ext r
  simp [rest, and_comm]

omit [Fintype ι] in
/-- Swapping `p` and `q` in `flip2 p q 0 1` gives `flip2 q p 1 0`. -/
theorem flip2_swap {p q : ι} (hpq : p ≠ q) : flip2 p q 0 1 = flip2 q p 1 0 := by
  funext r
  by_cases hrp : r = p
  · subst hrp
    rw [flip2_p hpq, flip2_q]
  · by_cases hrq : r = q
    · subst hrq
      rw [flip2_q, flip2_p (Ne.symm hpq)]
    · rw [flip2_rest hrp hrq, flip2_rest hrq hrp]

/-- The no-flip term `cos² φ E₀[Z_p Z_q]` vanishes. -/
theorem sum_no_flip (φ : ℝ) (J : ι → ι → ℝ) {p q : ι} (hpq : p ≠ q) :
    ∑ x, heis φ true 0 (x p) * heis φ true 0 (x q) *
        ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + flip2 p q 0 0 r) = 0 := by
  have hpt : ∀ x : ι → Fin 2, heis φ true 0 (x p) * heis φ true 0 (x q) *
      ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + flip2 p q 0 0 r) =
      ((2 : ℂ) ^ Fintype.card ι)⁻¹ * (Real.cos φ : ℂ) ^ 2 *
        ((∏ r ∈ {p, q}, (spin (x r) : ℂ)) * exp (↑(∑ r, (0 : ι → ℝ) r * spin (x r)) * I)) := by
    intro x
    have h0 : (fun r ↦ x r + flip2 p q 0 0 r) = x := by
      funext r
      simp [flip2]
    rw [h0, conj_isingState_mul, Finset.prod_pair hpq]
    simp only [heis, ite_true, sub_self, Complex.ofReal_zero, zero_mul, Complex.exp_zero,
      Pi.zero_apply, Finset.sum_const_zero]
    ring
  simp only [hpt, ← Finset.mul_sum, sum_spin_exp]
  rw [prod_spinFactor_eq_zero _ _ (by simp : p ∈ ({p, q} : Finset ι)) rfl, mul_zero]

/-- **Two-point function of the Ising-`Rx` readout.** For a symmetric coupling with zero diagonal
and distinct qubits `p ≠ q`,
`E_φ[Z_p Z_q] = (sin 2φ / 2) sin J_pq (∏_{r≠p,q} cos J_pr + ∏_{r≠p,q} cos J_qr)
  + (sin² φ / 2) (∏_{r≠p,q} cos (J_pr - J_qr) - ∏_{r≠p,q} cos (J_pr + J_qr))`. -/
theorem isingTwoPoint (φ : ℝ) (J : ι → ι → ℝ) (hJ : ∀ r t, J r t = J t r)
    (hJ0 : ∀ r, J r r = 0) {p q : ι} (hpq : p ≠ q) :
    expect φ J (fun y ↦ spin (y p) * spin (y q)) =
      Real.sin (2 * φ) / 2 * Real.sin (J p q) *
          (∏ r ∈ rest p q, Real.cos (J p r) + ∏ r ∈ rest p q, Real.cos (J q r)) +
        Real.sin φ ^ 2 / 2 * (∏ r ∈ rest p q, Real.cos (J p r - J q r) -
          ∏ r ∈ rest p q, Real.cos (J p r + J q r)) := by
  apply Complex.ofReal_injective
  rw [expect_two_point_expand φ J p q hpq]
  simp only [sum_flip_patterns φ p q hpq]
  rw [Finset.sum_comm]
  simp only [Fin.sum_univ_two, Finset.sum_add_distrib]
  have h01 : ∑ x, heis φ true 0 (x p) * heis φ true 1 (x q) *
      ((starRingEnd ℂ) (isingState J x) * isingState J fun r ↦ x r + flip2 p q 0 1 r) =
      ((Real.sin φ * Real.cos φ * Real.sin (J q p) * ∏ r ∈ rest q p, Real.cos (J q r) : ℝ) :
        ℂ) := by
    rw [← sum_one_flip φ J hJ hJ0 (Ne.symm hpq), flip2_swap hpq]
    exact Finset.sum_congr rfl fun x _ ↦ by ring
  rw [sum_no_flip φ J hpq, sum_one_flip φ J hJ hJ0 hpq, h01, sum_two_flip φ J hJ hJ0 hpq,
    hJ q p, ← rest_comm, Real.sin_two_mul]
  push_cast
  ring

end

end BotgeLean
