/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import Mathlib.Data.Finset.Prod
public import Mathlib.Data.Nat.Log
import Mathlib.Algebra.Order.Ring.Star
import Mathlib.Tactic.Bound
import Mathlib.Tactic.NormNum.Ineq

/-!
# Register budget (Proposition 2.1, `prop:budget`)

Botge caps the base and overlay emote pools piecewise so that the circuit never exceeds sixteen
qubits. This file proves the register-width bounds, strict half-occupancy, the exact occupancy of
one-qubit registers, and the Hilbert-space dimension bound `2 ^ (n_b + n_o) ≤ 65536`.

It also defines the admissible domain of triples `(n_b, n_o, L)` used by the rest of the
formalization and proves that it has exactly `414` elements.
-/

namespace BotgeLean

@[expose] public section

/-- Base-pool cap `M_b^max` from `eq:pool-cap`. -/
def baseCap (cb : ℕ) : ℕ := if cb ≤ 512 then 512 else 1024

/-- Overlay-pool cap `M_o^max` from `eq:pool-cap`. -/
def overlayCap (cb : ℕ) : ℕ := if cb ≤ 512 then 128 else 64

/-- Register width `n = ⌈log₂ M⌉` from `eq:bit-widths`. -/
def width (m : ℕ) : ℕ := Nat.clog 2 m

/-- Botge's admissible domain: `n_b ∈ 1..10`, `n_o ∈ 1..7`, `n_b + n_o ≤ 16`, `L ∈ 1..6`. -/
def Admissible (nb no L : ℕ) : Prop :=
  1 ≤ nb ∧ nb ≤ 10 ∧ 1 ≤ no ∧ no ≤ 7 ∧ nb + no ≤ 16 ∧ 1 ≤ L ∧ L ≤ 6

instance (nb no L : ℕ) : Decidable (Admissible nb no L) := by
  unfold Admissible
  infer_instance

/-- The finite set of admissible triples `(n_b, n_o, L)`. -/
def admissibleTriples : Finset (ℕ × ℕ × ℕ) :=
  (Finset.range 11 ×ˢ Finset.range 8 ×ˢ Finset.range 7).filter
    fun t ↦ Admissible t.1 t.2.1 t.2.2

/-- Proposition 2.1 (`prop:budget`): every lattice point of the admissible domain is counted;
there are exactly `69 × 6 = 414` admissible triples. -/
theorem prop_2_1_card_admissible : admissibleTriples.card = 414 := by
  decide +kernel

/-- Lattice-membership characterization of `admissibleTriples`. -/
theorem mem_admissibleTriples {nb no L : ℕ} :
    (nb, no, L) ∈ admissibleTriples ↔ Admissible nb no L := by
  simp only [admissibleTriples, Finset.mem_filter, Finset.mem_product, Finset.mem_range,
    and_iff_right_iff_imp]
  rintro ⟨-, h10, -, h7, -, -, h6⟩
  omega

private theorem clog_bounds {m cap k : ℕ} (hm : 2 ≤ m) (hcap : cap = 2 ^ k) (hk : 1 ≤ k) :
    let M := min m cap
    1 ≤ width M ∧ width M ≤ k ∧ 2 ^ (width M - 1) < M ∧ M ≤ 2 ^ width M ∧
      (width M = 1 → M = 2) := by
  intro M
  have h12 : (1 : ℕ) < 2 := by decide
  have hM2 : 2 ≤ M := le_min hm (by subst hcap; exact Nat.le_self_pow (by omega) 2 |>.trans' le_rfl)
  have hMcap : M ≤ 2 ^ k := hcap ▸ min_le_right m cap
  have hpos : 1 ≤ width M := Nat.clog_pos h12 (by omega)
  have hle : width M ≤ k := (Nat.clog_le_iff_le_pow h12).2 hMcap
  have hlt : 2 ^ (width M - 1) < M := Nat.pow_pred_clog_lt_self 2 (by omega)
  have hge : M ≤ 2 ^ width M := Nat.le_pow_clog h12 _
  refine ⟨hpos, hle, hlt, hge, fun h1 ↦ ?_⟩
  rw [h1] at hge
  omega

/-- Proposition 2.1 (`prop:budget`): for domain sizes `C_b, C_o ≥ 2`, the capped pools give
`n_b ∈ 1..10`, `n_o ∈ 1..7`, `n_b + n_o ≤ 16`, strict half-occupancy `N / 2 < M ≤ N`, exact
occupancy `M = 2` when `n = 1`, and `dim H = 2 ^ n_b * 2 ^ n_o = 2 ^ (n_b + n_o) ≤ 65536`. -/
theorem prop_2_1_budget (cb co : ℕ) (hcb : 2 ≤ cb) (hco : 2 ≤ co) :
    let Mb := min cb (baseCap cb)
    let Mo := min co (overlayCap cb)
    let nb := width Mb
    let no := width Mo
    1 ≤ nb ∧ nb ≤ 10 ∧ 1 ≤ no ∧ no ≤ 7 ∧ nb + no ≤ 16 ∧
      2 ^ (nb - 1) < Mb ∧ Mb ≤ 2 ^ nb ∧ 2 ^ (no - 1) < Mo ∧ Mo ≤ 2 ^ no ∧
      (nb = 1 → Mb = 2) ∧ (no = 1 → Mo = 2) ∧
      2 ^ nb * 2 ^ no = 2 ^ (nb + no) ∧ 2 ^ (nb + no) ≤ 65536 := by
  dsimp only
  by_cases h : cb ≤ 512
  · rw [show baseCap cb = 512 by simp [baseCap, h],
      show overlayCap cb = 128 by simp [overlayCap, h]]
    obtain ⟨hb1, hb9, hblt, hbge, hbeq⟩ :=
      clog_bounds (m := cb) (cap := 512) (k := 9) hcb (by norm_num) (by norm_num)
    obtain ⟨ho1, ho7, holt, hoge, hoeq⟩ :=
      clog_bounds (m := co) (cap := 128) (k := 7) hco (by norm_num) (by norm_num)
    have hsum : width (min cb 512) + width (min co 128) ≤ 16 := by omega
    refine ⟨hb1, by omega, ho1, ho7, hsum, hblt, hbge, holt, hoge, hbeq, hoeq, (pow_add _ _ _).symm,
      ?_⟩
    calc 2 ^ (width (min cb 512) + width (min co 128)) ≤ 2 ^ 16 :=
          Nat.pow_le_pow_right (by norm_num) hsum
      _ = 65536 := by norm_num
  · rw [show baseCap cb = 1024 by simp [baseCap, h],
      show overlayCap cb = 64 by simp [overlayCap, h]]
    obtain ⟨hb1, hb10, hblt, hbge, hbeq⟩ :=
      clog_bounds (m := cb) (cap := 1024) (k := 10) hcb (by norm_num) (by norm_num)
    obtain ⟨ho1, ho6, holt, hoge, hoeq⟩ :=
      clog_bounds (m := co) (cap := 64) (k := 6) hco (by norm_num) (by norm_num)
    have hsum : width (min cb 1024) + width (min co 64) ≤ 16 := by omega
    refine ⟨hb1, hb10, ho1, by omega, hsum, hblt, hbge, holt, hoge, hbeq, hoeq,
      (pow_add _ _ _).symm, ?_⟩
    calc 2 ^ (width (min cb 1024) + width (min co 64)) ≤ 2 ^ 16 :=
          Nat.pow_le_pow_right (by norm_num) hsum
      _ = 65536 := by norm_num

/-- Proposition 2.1 (`prop:budget`): every capped pool pair yields an admissible triple for each
entanglement depth `L ∈ 1..6`. -/
theorem prop_2_1_admissible (cb co L : ℕ) (hcb : 2 ≤ cb) (hco : 2 ≤ co) (hL1 : 1 ≤ L)
    (hL6 : L ≤ 6) :
    Admissible (width (min cb (baseCap cb))) (width (min co (overlayCap cb))) L := by
  obtain ⟨h1, h2, h3, h4, h5, -⟩ := prop_2_1_budget cb co hcb hco
  exact ⟨h1, h2, h3, h4, h5, hL1, hL6⟩

end

end BotgeLean
