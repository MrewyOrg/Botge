"""Check Proposition 2.1 and that the solver finds counterexamples to wrong caps."""

import contextlib
import io
import unittest

from symbolic_budget import (
    NARROW_CAPS,
    SEARCH_BITS,
    budget_holds,
    ceil_log2_constraint,
    has_width,
    power_of_two,
    verify_budget,
)
from symbolic_support import z3


class BudgetTests(unittest.TestCase):
    """Decide the register claims for the specification caps and for broken ones."""

    def test_specification_caps_hold(self) -> None:
        """The published caps satisfy every register claim, and the check reports it."""
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            verify_budget()
        self.assertEqual(stdout.getvalue(), 'Proposition 2.1 (Z3): passed\n')

    def test_caps_that_exceed_sixteen_qubits_have_a_counterexample(self) -> None:
        """A 128-emote overlay beside a 1024-emote base needs 17 qubits; 256 overlays need 8."""
        self.assertFalse(budget_holds(wide_caps=(1024, 128)))
        self.assertFalse(budget_holds(narrow_caps=(NARROW_CAPS[0], 256)))

    def test_caps_beyond_a_register_limit_have_a_counterexample(self) -> None:
        """Widths past the qubit limits or a non-power-of-two cap are found, not skipped."""
        self.assertFalse(budget_holds(narrow_caps=(NARROW_CAPS[0], 200)))
        self.assertFalse(budget_holds(wide_caps=(2048, 32)))
        self.assertFalse(budget_holds(wide_caps=(1000, 64)))

    def test_ceil_log2_constraint_picks_the_smallest_width(self) -> None:
        """`⌈log₂ 5⌉ = 3`, and the search reaches widths beyond every register limit."""
        bits, size = z3.Ints('bits size')
        solver = z3.Solver()
        solver.add(ceil_log2_constraint(5, bits))
        solver.add(power_of_two(bits, size))
        self.assertEqual(solver.check(), z3.sat)
        self.assertEqual(solver.model()[bits].as_long(), 3)
        self.assertEqual(solver.model()[size].as_long(), 8)
        wide = z3.Solver()
        wide.add(ceil_log2_constraint(1 << SEARCH_BITS, bits))
        self.assertEqual(wide.check(), z3.sat)
        self.assertEqual(wide.model()[bits].as_long(), SEARCH_BITS)

    def test_has_width_rejects_pools_outside_the_search(self) -> None:
        """A single emote and a pool past `2^SEARCH_BITS` have no searched width."""
        for pool in (1, (1 << SEARCH_BITS) + 1):
            solver = z3.Solver()
            solver.add(has_width(pool))
            self.assertEqual(solver.check(), z3.unsat)
