"""Check the Theorem 4.1 identities and bounds."""

import contextlib
import io
import unittest

from symbolic_entanglement import verify_entanglement


class EntanglementTests(unittest.TestCase):
    """Run the Dirichlet, normalization and coupling-scale checks."""

    def test_identities_and_bounds_hold(self) -> None:
        """Every Theorem 4.1 step passes."""
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            verify_entanglement()
        self.assertEqual(stdout.getvalue(), 'Theorem 4.1 (SymPy): passed\n')
