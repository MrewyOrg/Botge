/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import BotgeLean.Entanglement
public import BotgeLean.TwoByTwo

/-!
# The general circuit at `n_b = n_o = 1` (Corollary 4.4, `cor:two-by-two`)

This module proves that the general circuit `psi` at `n_b = n_o = 1` prepares the closed form
`e^{iπ/4}(cos(ϑ/2)|++⟩ + sin(ϑ/2)|--⟩)` of `TwoByTwo` (`cor_4_4_psi`), computes the reduced
state of the actual output, `ρ_B = ½ I + ½ cos ϑ_L X` (`cor_4_4_rhoB`), and proves its von Neumann
entropy is `S(ρ_B) = h((1 + cos ϑ_L) / 2)` nats (`cor_4_4_entropy`).
-/

open Complex Finset Matrix Polynomial
open scoped ComplexOrder

namespace BotgeLean

@[expose] public section

/-- Index of a `2 × 2` outcome in `psiTwoByTwoClosed`: the base bit is high, the overlay bit low. -/
def twoByTwoEquiv : (Fin 1 ⊕ Fin 1 → Fin 2) ≃ Fin 4 where
  toFun y := ⟨2 * (y (.inl 0) : ℕ) + y (.inr 0), by
    have := (y (.inl 0)).isLt
    have := (y (.inr 0)).isLt
    omega⟩
  invFun i := Sum.elim (fun _ ↦ ⟨i / 2, by have := i.isLt; omega⟩)
    (fun _ ↦ ⟨i % 2, by have := i.isLt; omega⟩)
  left_inv y := by
    have h0 := (y (.inl 0)).isLt
    have h1 := (y (.inr 0)).isLt
    funext q
    rcases q with q | q <;> rw [Fin.fin_one_eq_zero q] <;> ext <;> simp <;> omega
  right_inv i := by
    have := i.isLt
    ext
    simp
    omega

/-- The Ising phase state at `n_b = n_o = 1` is `e^{i (u_L / 4) s_b s_o} / 2`. -/
theorem isingState_one_one (L : ℕ) (a b : Fin 2) :
    isingState (coupling 1 1 L) (Sum.elim (fun _ ↦ a) (fun _ ↦ b)) =
      exp (((uL L / 4 * spin a * spin b : ℝ) : ℂ) * I) / 2 := by
  rw [isingState, energy_coupling]
  simp only [Fintype.card_sum, Fintype.card_fin, Fin.sum_univ_one, Sum.elim_inl, Sum.elim_inr,
    theta, Fin.val_zero, pow_zero, mul_one, max_self, pow_one]
  have hsqrt : ((Real.sqrt 2 : ℂ)⁻¹) ^ (1 + 1) = 1 / 2 := by
    rw [inv_pow, ← Complex.ofReal_pow, Real.sq_sqrt (by norm_num)]
    norm_num
  rw [hsqrt, one_div, mul_comm, div_eq_mul_inv]
  congr 2
  push_cast
  ring

/-- Corollary 4.4, `eq:two-by-two-state`, for the general circuit: at `n_b = n_o = 1` the output
amplitudes are `e^{iπ/4}(cos(ϑ_L/2)|++⟩ + sin(ϑ_L/2)|--⟩)`. -/
theorem cor_4_4_psi (L : ℕ) (y : Fin 1 ⊕ Fin 1 → Fin 2) :
    psi (-(Real.pi / 4)) (coupling 1 1 L) y =
      psiTwoByTwoClosed (varthetaL L) (twoByTwoEquiv y) := by
  set α : ℝ := Real.pi / 8
  have h2α : 2 * α = Real.pi / 4 := by simp only [α]; ring
  have hcos : (Real.cos α : ℂ) ^ 2 - (Real.sin α : ℂ) ^ 2 = ((Real.sqrt 2 / 2 : ℝ) : ℂ) := by
    have h2 := Real.cos_two_mul α
    rw [h2α, Real.cos_pi_div_four] at h2
    have h1 := Real.cos_sq_add_sin_sq α
    exact_mod_cast (by linarith : Real.cos α ^ 2 - Real.sin α ^ 2 = Real.sqrt 2 / 2)
  have hsin : 2 * (Real.sin α : ℂ) * (Real.cos α : ℂ) = ((Real.sqrt 2 / 2 : ℝ) : ℂ) := by
    have h2 := Real.sin_two_mul α
    rw [h2α, Real.sin_pi_div_four] at h2
    exact_mod_cast h2.symm
  have hi2 : I ^ 2 = -1 := I_sq
  have hrx : ∀ a b : Fin 2, rx (-(Real.pi / 4)) a b =
      if a = b then (Real.cos α : ℂ) else I * (Real.sin α : ℂ) := by
    have h : -(Real.pi / 4) / 2 = -α := by simp only [α]; ring
    intro a b
    fin_cases a <;> fin_cases b <;> simp [rx, h, Real.cos_neg, Real.sin_neg]
  have hphase : ∀ a b : Fin 2, isingState (coupling 1 1 L) (Sum.elim (fun _ ↦ a) (fun _ ↦ b)) =
      ((Real.cos (varthetaL L / 2) : ℂ) +
        I * (spin a * spin b : ℝ) * (Real.sin (varthetaL L / 2) : ℂ)) / 2 := by
    have hu : uL L / 4 = varthetaL L / 2 := by simp only [varthetaL]; ring
    intro a b
    rw [isingState_one_one, Complex.exp_mul_I, ← Complex.ofReal_cos, ← Complex.ofReal_sin]
    fin_cases a <;> fin_cases b <;> simp [spin, hu, Real.cos_neg, Real.sin_neg] <;> ring
  obtain ⟨i, rfl⟩ := twoByTwoEquiv.symm.surjective y
  rw [Equiv.apply_symm_apply, psi_apply, ← twoByTwoEquiv.symm.sum_comp, Fin.sum_univ_four]
  simp only [twoByTwoEquiv, Equiv.coe_fn_symm_mk, Fintype.prod_sum_type, Fin.prod_univ_one,
    Sum.elim_inl, Sum.elim_inr, hrx, hphase]
  have hcases : i = 0 ∨ i = 1 ∨ i = 2 ∨ i = 3 := by
    rcases i with ⟨v, hv⟩
    interval_cases v <;> simp [Fin.ext_iff]
  rcases hcases with rfl | rfl | rfl | rfl <;> dsimp only [psiTwoByTwoClosed] <;>
    rw [exp_I_pi_div_four] <;> norm_num [Fin.ext_iff, spin, ← Complex.ofReal_cos,
      ← Complex.ofReal_sin] <;> push_cast at hcos hsin ⊢
  · set c := Complex.cos ((varthetaL L : ℂ) / 2)
    set s := Complex.sin ((varthetaL L : ℂ) / 2)
    set C := Complex.cos (α : ℂ)
    set S := Complex.sin (α : ℂ)
    linear_combination (c + I * s) / 2 * hcos + (I * c + s) / 2 * hsin +
      (S ^ 2 * (c + I * s) - 2 * S * C * s) / 2 * hi2
  · set c := Complex.cos ((varthetaL L : ℂ) / 2)
    set s := Complex.sin ((varthetaL L : ℂ) / 2)
    set C := Complex.cos (α : ℂ)
    set S := Complex.sin (α : ℂ)
    linear_combination (c - I * s) / 2 * hcos + (I * c - s) / 2 * hsin +
      (S ^ 2 * (c - I * s) + 2 * S * C * s) / 2 * hi2
  · set c := Complex.cos ((varthetaL L : ℂ) / 2)
    set s := Complex.sin ((varthetaL L : ℂ) / 2)
    set C := Complex.cos (α : ℂ)
    set S := Complex.sin (α : ℂ)
    linear_combination (c - I * s) / 2 * hcos + (I * c - s) / 2 * hsin +
      (S ^ 2 * (c - I * s) + 2 * S * C * s) / 2 * hi2
  · set c := Complex.cos ((varthetaL L : ℂ) / 2)
    set s := Complex.sin ((varthetaL L : ℂ) / 2)
    set C := Complex.cos (α : ℂ)
    set S := Complex.sin (α : ℂ)
    linear_combination (c + I * s) / 2 * hcos + (I * c + s) / 2 * hsin +
      (S ^ 2 * (c + I * s) - 2 * S * C * s) / 2 * hi2

/-- The real amplitude factor `cos(ϑ_L/2)/2 + s_a s_c sin(ϑ_L/2)/2` of the `2 × 2` output. -/
noncomputable def twoByTwoAmp (L : ℕ) (a c : Fin 2) : ℝ :=
  Real.cos (varthetaL L / 2) / 2 + spin a * spin c * Real.sin (varthetaL L / 2) / 2

/-- Every `2 × 2` amplitude is the global phase `e^{iπ/4}` times a real factor. -/
theorem ampMat_one_one (L : ℕ) (a c : Fin 2) :
    ampMat 1 1 (-(Real.pi / 4)) (coupling 1 1 L) (fun _ ↦ a) (fun _ ↦ c) =
      exp (I * ((Real.pi / 4 : ℝ) : ℂ)) * (twoByTwoAmp L a c : ℂ) := by
  rw [ampMat, of_apply, cor_4_4_psi]
  fin_cases a <;> fin_cases c <;>
    simp [psiTwoByTwoClosed, twoByTwoEquiv, twoByTwoAmp, spin] <;> ring

/-- `Σ_c r(a, c) r(a', c)` is `1/2` on the diagonal and `cos ϑ_L / 2` off it. -/
theorem twoByTwoAmp_gram (L : ℕ) (a a' : Fin 2) :
    ∑ c : Fin 2, twoByTwoAmp L a c * twoByTwoAmp L a' c =
      if a = a' then 1 / 2 else Real.cos (varthetaL L) / 2 := by
  have hcs := Real.cos_sq_add_sin_sq (varthetaL L / 2)
  have hcos : Real.cos (varthetaL L) =
      Real.cos (varthetaL L / 2) ^ 2 - Real.sin (varthetaL L / 2) ^ 2 := by
    have h2 := Real.cos_two_mul (varthetaL L / 2)
    rw [show 2 * (varthetaL L / 2) = varthetaL L by ring] at h2
    linarith
  fin_cases a <;> fin_cases a' <;> simp [Fin.sum_univ_two, twoByTwoAmp, spin, hcos] <;>
    nlinarith [hcs]

/-- Corollary 4.4 (1) for the general circuit: `ρ_B = ½ I + ½ cos ϑ_L X` at `n_b = n_o = 1`. -/
theorem cor_4_4_rhoB (L : ℕ) (a a' : Fin 2) :
    rhoB (ampMat 1 1 (-(Real.pi / 4)) (coupling 1 1 L)) (fun _ ↦ a) (fun _ ↦ a') =
      ((if a = a' then 1 / 2 else Real.cos (varthetaL L) / 2 : ℝ) : ℂ) := by
  have hphase : exp (I * ((Real.pi / 4 : ℝ) : ℂ)) *
      (starRingEnd ℂ) (exp (I * ((Real.pi / 4 : ℝ) : ℂ))) = 1 := by
    rw [Complex.mul_conj, Complex.normSq_eq_norm_sq, mul_comm, Complex.norm_exp_ofReal_mul_I]
    norm_num
  rw [rhoB, Matrix.mul_apply, ← twoByTwoAmp_gram L a a', Complex.ofReal_sum]
  refine Fintype.sum_equiv (Equiv.funUnique (Fin 1) (Fin 2)) _ _ fun o ↦ ?_
  have ho : o = fun _ ↦ o 0 := funext fun q ↦ by rw [Fin.fin_one_eq_zero q]
  rw [conjTranspose_apply, ho, ampMat_one_one, ampMat_one_one]
  simp only [Equiv.funUnique_apply, star_mul', Complex.star_def,
    Complex.conj_ofReal, Complex.ofReal_mul]
  linear_combination (twoByTwoAmp L a (o 0) * twoByTwoAmp L a' (o 0) : ℂ) * hphase

/-- Corollary 4.4 (1) for the general circuit: `S(ρ_B) = h((1 + cos ϑ_L) / 2)` nats at
`n_b = n_o = 1`, the binary entropy of the eigenvalues `(1 ± cos ϑ_L) / 2`. -/
theorem cor_4_4_entropy (L : ℕ) :
    vonNeumann (rhoB (ampMat 1 1 (-(Real.pi / 4)) (coupling 1 1 L)))
        (rhoB_posSemidef _).isHermitian =
      Real.binEntropy ((1 + Real.cos (varthetaL L)) / 2) := by
  set ρ := rhoB (ampMat 1 1 (-(Real.pi / 4)) (coupling 1 1 L))
  set k : ℂ := ((Real.cos (varthetaL L) / 2 : ℝ) : ℂ)
  set l₁ : ℝ := (1 + Real.cos (varthetaL L)) / 2
  set l₂ : ℝ := (1 - Real.cos (varthetaL L)) / 2
  set e := Equiv.funUnique (Fin 1) (Fin 2)
  have hM : reindex e e ρ = !![1 / 2, k; k, 1 / 2] := by
    ext i j
    have hsymm : ∀ t : Fin 2, e.symm t = fun _ ↦ t := fun t ↦ rfl
    fin_cases i <;> fin_cases j <;>
      simp [reindex_apply, submatrix_apply, hsymm, ρ, cor_4_4_rhoB, k]
  have hchar : ρ.charpoly = (X - C (l₁ : ℂ)) * (X - C (l₂ : ℂ)) := by
    rw [← charpoly_reindex e, hM, charpoly_fin_two, trace_fin_two, det_fin_two]
    simp only [of_apply, cons_val', cons_val_zero, cons_val_one, empty_val', cons_val_fin_one]
    have hsum : (1 / 2 + 1 / 2 : ℂ) = (l₁ : ℂ) + l₂ := by
      simp only [l₁, l₂]
      push_cast
      ring
    have hprod : (1 / 2 * (1 / 2) - k * k : ℂ) = (l₁ : ℂ) * l₂ := by
      simp only [k, l₁, l₂]
      push_cast
      ring
    rw [hsum, hprod, C_add, C_mul]
    ring
  rw [vonNeumann_eq_sum_roots, hchar,
    roots_mul (mul_ne_zero (X_sub_C_ne_zero _) (X_sub_C_ne_zero _)), roots_X_sub_C,
    roots_X_sub_C, Real.binEntropy_eq_negMulLog_add_negMulLog_one_sub,
    show 1 - l₁ = l₂ by simp only [l₁, l₂]; ring]
  simp

end

end BotgeLean
