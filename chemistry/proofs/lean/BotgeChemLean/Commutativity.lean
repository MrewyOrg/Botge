/-
Copyright (c) 2026 MrewyOrg. All rights reserved.
Released under the MIT license as described in the file LICENSE.txt.
Authors: Mrewy
-/
module

public import Mathlib.Data.Nat.Basic

/-!
# Reactant-order invariance (`thm:commutativity`)

Proves that canonicalizing an unordered pair of substrate indices into `(min a b, max a b)`
is symmetric under swapping `a` and `b`, so any deterministic evaluator built on top of the
canonical pair is invariant under reactant order.
-/

namespace BotgeChemLean

@[expose] public section

/-- Canonical ordered pair `(min a b, max a b)`. -/
def canonPair (a b : ℕ) : ℕ × ℕ := (min a b, max a b)

/-- Theorem 4.1 (`thm:commutativity`): canonical pair construction is commutative. -/
theorem thm_4_1_canonPair_comm (a b : ℕ) : canonPair a b = canonPair b a := by
  dsimp only [canonPair]
  rw [min_comm, max_comm]

/-- Theorem 4.1 (`thm:commutativity`): any evaluator depending only on `canonPair` and condition
`c` produces identical results when reactants `a` and `b` are swapped. -/
theorem thm_4_1_eval_comm {α : Type*} (f : ℕ × ℕ → ℕ → α) (a b c : ℕ) :
    f (canonPair a b) c = f (canonPair b a) c := by
  rw [thm_4_1_canonPair_comm]

end

end BotgeChemLean
