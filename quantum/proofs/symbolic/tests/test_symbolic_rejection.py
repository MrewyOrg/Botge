"""Check Theorem 5.1 and that a weaker acceptance floor has a counterexample."""

import contextlib
import io
import unittest

from symbolic_rejection import acceptance_floor_holds, verify_rejection


class RejectionTests(unittest.TestCase):
    """Run the rejection-sampling checks and a broken floor."""

    def test_partial_sums_limits_and_floor_hold(self) -> None:
        """Every Theorem 5.1 step passes."""
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            verify_rejection()
        self.assertEqual(stdout.getvalue(), 'Theorem 5.1 (SymPy, Z3): passed\n')

    def test_weaker_wide_floor_has_a_counterexample(self) -> None:
        """`p_A ≥ (1 + c) / 5` no longer guarantees `p_A > 1/4`."""
        self.assertTrue(acceptance_floor_holds())
        self.assertFalse(acceptance_floor_holds(wide_floor_divisor=5))
